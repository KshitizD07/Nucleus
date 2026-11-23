import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorServer } from "../server/coordinator-server.js";
import { DaemonClient, PeersIndexManager, ShadowMirror, WorkspaceDiffWatcher, TaskBoardReplica } from "@nucleus/daemon";
import { WorktreeManager, DeterministicRunner, MarkdownCritiqueFormatter } from "@nucleus/critic";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const PORT = 9010;
const ROOM_ID = "e2e-stress-room";
const BASE_DIR = "./test_e2e_run";

describe("Milestone 3 & 4 Extended: Stress, Shadow Throughput & Critique Gate Pipeline", () => {
  let coordinator: CoordinatorServer;
  const logDir = `${BASE_DIR}/logs`;
  const contractDir = `${BASE_DIR}/CONTRACT`;
  const worktreesDir = `${BASE_DIR}/worktrees`;
  const beWs = `${BASE_DIR}/ws_backend`;
  const feWs = `${BASE_DIR}/ws_frontend`;

  beforeEach(() => {
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(contractDir, { recursive: true });
    fs.mkdirSync(worktreesDir, { recursive: true });
    fs.mkdirSync(beWs, { recursive: true });
    fs.mkdirSync(feWs, { recursive: true });

    coordinator = new CoordinatorServer({
      port: PORT,
      roomId: ROOM_ID,
      logDir,
      contractDir,
      taskDir: logDir
    });

    coordinator.getTaskBoard().addTask({
      id: "task-auth-jwt",
      title: "Implement Concurrency Soft-Lock API",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: ["api.md"]
    });

    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
    fs.rmSync(BASE_DIR, { recursive: true, force: true });
  });

  it("SHADOW THROUGHPUT: Rapid sequential edits stream into peer shadows with version order", async () => {
    const tokenBE = coordinator.issueInvite("backend");
    const tokenFE = coordinator.issueInvite("frontend");

    const feMirror = new ShadowMirror(feWs);
    const daemonBE = new DaemonClient({
      url: `ws://localhost:${PORT}`,
      node_id: "node-be",
      join_token: tokenBE,
      workspace_path: beWs,
      lane: "backend"
    });

    const daemonFE = new DaemonClient({
      url: `ws://localhost:${PORT}`,
      node_id: "node-fe",
      join_token: tokenFE,
      workspace_path: feWs,
      lane: "frontend"
    });

    await daemonBE.connect();
    await daemonFE.connect();

    const receivedVersions: number[] = [];
    daemonFE.onMessage = (type, payload: any) => {
      if (type === "sharing:lane_shadow_sync") {
        feMirror.applySync(payload);
        receivedVersions.push(payload.version);
      }
    };

    const updateCount = 10;
    const startTs = performance.now();

    for (let i = 1; i <= updateCount; i++) {
      daemonBE.syncLaneShadow("backend", "src/api/auth.ts", `// Version ${i} content\nconst x = ${i};`, i);
    }

    // Wait briefly for network flush
    await new Promise((r) => setTimeout(r, 150));
    const durationMs = performance.now() - startTs;

    console.log(`\n[SHADOW STRESS] ${updateCount} shadow delta syncs processed in ${durationMs.toFixed(2)}ms`);

    expect(receivedVersions.length).toBe(updateCount);
    // Verify latest version on FE disk
    const content = feMirror.readShadowFile("backend", "src/api/auth.ts");
    expect(content).toContain(`const x = ${updateCount};`);

    daemonBE.sever();
    daemonFE.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("CRITIQUE GATE REJECTION: Failed checks properly trigger changes_requested verdict", () => {
    const repoRoot = path.resolve(".");
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    const wtManager = new WorktreeManager(repoRoot, worktreesDir);

    const wt = wtManager.createWorktree("task-fail-eval", currentBranch);
    expect(wt.success).toBe(true);

    // Intentionally run a failing check command
    const checks = DeterministicRunner.runChecks(wt.worktreePath, [
      {
        name: "Security Secret Check (Passing)",
        command: "node -e \"process.exit(0)\""
      },
      {
        name: "Mock Integration Test (Failing)",
        command: "node -e \"console.error('Fatal: JWT secret not set'); process.exit(1)\""
      }
    ]);

    expect(checks.passed).toBe(false);
    expect(checks.results[1].passed).toBe(false);
    expect(checks.results[1].output).toContain("JWT secret not set");

    // Format critique markdown output with rejection
    const critiqueMd = MarkdownCritiqueFormatter.format({
      task_id: "task-fail-eval",
      lane: "backend",
      verdict: "changes_requested",
      deterministic_checks_passed: false,
      findings: [
        {
          severity: "critical",
          file: "src/auth.ts",
          message: checks.results[1].error || "Test failure",
          suggested_fix: "Define JWT_SECRET environment variable in config"
        }
      ],
      critique_file_path: ".nucleus/critiques/task-fail-eval.md"
    });

    expect(critiqueMd).toContain("**Verdict:** CHANGES_REQUESTED");
    expect(critiqueMd).toContain("**Deterministic Checks:** FAILED");
    expect(critiqueMd).toContain("[CRITICAL] src/auth.ts");
    expect(critiqueMd).toContain("JWT_SECRET");

    wtManager.removeWorktree("task-fail-eval");
    expect(fs.existsSync(wt.worktreePath)).toBe(false);
  });
});
