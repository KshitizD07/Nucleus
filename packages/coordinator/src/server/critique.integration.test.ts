import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorServer } from "../server/coordinator-server.js";
import { DaemonClient, TaskBoardReplica } from "@nucleus/daemon";
import { WorktreeManager, DeterministicRunner, MarkdownCritiqueFormatter } from "@nucleus/critic";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const TEST_PORT = 9008;
const TEST_ROOM = "test-critique-room";
const LOG_DIR = "./test_logs_critique";
const WORKTREES_DIR = "./test_worktrees_eval";
const CONTRIBUTOR_WS = "./test_ws_contributor";

describe("Milestone 4: Task Board Lifecycle & Disposable Worktree Critique Pipeline", () => {
  let coordinator: CoordinatorServer;

  beforeEach(() => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.mkdirSync(WORKTREES_DIR, { recursive: true });
    fs.mkdirSync(CONTRIBUTOR_WS, { recursive: true });

    coordinator = new CoordinatorServer({
      port: TEST_PORT,
      roomId: TEST_ROOM,
      logDir: LOG_DIR
    });

    // Populate initial tasks on coordinator task board
    coordinator.getTaskBoard().addTask({
      id: "task-auth-01",
      title: "Implement TOTP 2FA Verification",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: ["api.md"]
    });

    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
    fs.rmSync(WORKTREES_DIR, { recursive: true, force: true });
    fs.rmSync(CONTRIBUTOR_WS, { recursive: true, force: true });
  });

  it("should claim task and broadcast status across peers", async () => {
    const token = coordinator.issueInvite("backend");
    const taskReplica = new TaskBoardReplica(CONTRIBUTOR_WS);

    const daemon = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-worker",
      join_token: token,
      workspace_path: CONTRIBUTOR_WS,
      lane: "backend"
    });

    await daemon.connect();

    // Listen for task updates
    const taskUpdatePromise = new Promise<any>((resolve) => {
      daemon.onMessage = (type, payload) => {
        if (type === "task:status") resolve(payload);
      };
    });

    daemon.claimTask("task-auth-01");
    const updatedTask = await taskUpdatePromise;

    expect(updatedTask.id).toBe("task-auth-01");
    expect(updatedTask.status).toBe("active");
    expect(updatedTask.assigned_to).toBe("node-worker");

    // Attempting to claim from a different lane (e.g., frontend node claiming backend task)
    const frontendToken = coordinator.issueInvite("frontend");
    const feDaemon = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-frontend",
      join_token: frontendToken,
      workspace_path: CONTRIBUTOR_WS,
      lane: "frontend"
    });
    await feDaemon.connect();

    // Add another backend task
    coordinator.getTaskBoard().addTask({
      id: "task-auth-02",
      title: "Backend Auth Task 2",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    const failedPromise = new Promise<any>((resolve) => {
      feDaemon.onMessage = (type, payload) => {
        if (type === "task:claim_failed") resolve(payload);
      };
    });

    feDaemon.claimTask("task-auth-02");
    const failedPayload = await failedPromise;
    expect(failedPayload.task_id).toBe("task-auth-02");
    expect(failedPayload.reason).toContain("Lane mismatch");
    expect(Array.isArray(failedPayload.available_tasks)).toBe(true);

    feDaemon.sever();

    // Apply into local replica
    taskReplica.applyUpdate(updatedTask);
    expect(taskReplica.getTask("task-auth-01")?.status).toBe("active");

    // Security Check: Node-worker cannot self-approve their own task
    const selfApprovePromise = new Promise<any>((resolve) => {
      daemon.onMessage = (type, payload) => {
        if (type === "task:update_failed") resolve(payload);
      };
    });
    daemon.updateTaskStatus("task-auth-01", "approved");
    const failedApproval = await selfApprovePromise;
    expect(failedApproval.task_id).toBe("task-auth-01");
    expect(failedApproval.reason).toContain("cannot directly set status to 'approved'");

    // Security Check: Cross-lane node cannot update backend task
    const crossLaneDaemon = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-frontend-hacker",
      join_token: coordinator.issueInvite("frontend"),
      workspace_path: CONTRIBUTOR_WS,
      lane: "frontend"
    });
    await crossLaneDaemon.connect();

    const crossUpdatePromise = new Promise<any>((resolve) => {
      crossLaneDaemon.onMessage = (type, payload) => {
        if (type === "task:update_failed") resolve(payload);
      };
    });
    crossLaneDaemon.updateTaskStatus("task-auth-01", "in_review");
    const crossFailed = await crossUpdatePromise;
    expect(crossFailed.reason).toContain("Lane mismatch");
    crossLaneDaemon.sever();

    daemon.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should run deterministic checks in disposable worktree and format markdown critique", () => {
    // Current repo root
    const repoRoot = path.resolve(".");
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();

    const wtManager = new WorktreeManager(repoRoot, WORKTREES_DIR);

    // Create a detached worktree of current branch
    const wtResult = wtManager.createWorktree("task-eval-test", currentBranch);
    expect(wtResult.success).toBe(true);
    expect(fs.existsSync(wtResult.worktreePath)).toBe(true);

    // Run deterministic checks inside the worktree
    const checksResult = DeterministicRunner.runChecks(wtResult.worktreePath, [
      {
        name: "Check Node Environment",
        command: "node -v"
      },
      {
        name: "Verify Package JSON Exists",
        command: "node -e \"if (!require('fs').existsSync('package.json')) process.exit(1)\""
      }
    ]);

    expect(checksResult.passed).toBe(true);
    expect(checksResult.results.length).toBe(2);

    // Format critique markdown output
    const formattedCritique = MarkdownCritiqueFormatter.format({
      task_id: "task-eval-test",
      lane: "backend",
      verdict: "approved",
      deterministic_checks_passed: true,
      findings: [],
      critique_file_path: ".nucleus/critiques/task-eval-test.md"
    });

    expect(formattedCritique).toContain("# Critique Review: Task [task-eval-test]");
    expect(formattedCritique).toContain("**Verdict:** APPROVED");
    expect(formattedCritique).toContain("No issues detected");

    // Clean up disposable worktree
    wtManager.removeWorktree("task-eval-test");
    expect(fs.existsSync(wtResult.worktreePath)).toBe(false);
  });
});
