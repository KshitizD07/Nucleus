import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CoordinatorServer } from "./coordinator-server.js";
import { DaemonClient } from "@nucleus/daemon";
import { ShadowMirror } from "@nucleus/daemon";
import { PeersIndexManager } from "@nucleus/daemon";
import { AICriticPipeline } from "@nucleus/critic";
import type { TaskItem } from "@nucleus/protocol";

const PORT = 9035;

describe("End-to-End Dogfooding Simulation (Initiator + Backend + Frontend Lanes)", () => {
  let tempBase: string;
  let serverDir: string;
  let backendDir: string;
  let frontendDir: string;
  let server: CoordinatorServer;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-dogfood-"));
    serverDir = path.join(tempBase, "server");
    backendDir = path.join(tempBase, "backend-workspace");
    frontendDir = path.join(tempBase, "frontend-workspace");

    fs.mkdirSync(serverDir, { recursive: true });
    fs.mkdirSync(backendDir, { recursive: true });
    fs.mkdirSync(frontendDir, { recursive: true });

    // Seed server contract
    const contractDir = path.join(serverDir, "CONTRACT");
    fs.mkdirSync(contractDir, { recursive: true });
    fs.writeFileSync(
      path.join(contractDir, "api.md"),
      "# Core API Contract v1\nEndpoints frozen.\n",
      "utf8"
    );

    // Seed task backlog
    const taskDir = path.join(serverDir, ".nucleus");
    fs.mkdirSync(taskDir, { recursive: true });
    const initialTasks: TaskItem[] = [
      {
        id: "task-auth-01",
        title: "Implement auth token login endpoint: Add POST /api/v1/auth/login returning JWT token",
        lane: "backend",
        assigned_to: null,
        status: "unassigned",
        depends_on_contracts: ["CONTRACT/api.md"]
      },
      {
        id: "task-ui-01",
        title: "Build login modal form: Render login screen consuming backend auth shape",
        lane: "frontend",
        assigned_to: null,
        status: "unassigned",
        depends_on_contracts: []
      }
    ];
    fs.writeFileSync(
      path.join(taskDir, "tasks.json"),
      JSON.stringify(initialTasks, null, 2),
      "utf8"
    );

    server = new CoordinatorServer({
      port: PORT,
      roomId: "dogfood-project-alpha",
      logDir: path.join(serverDir, "logs"),
      contractDir,
      taskDir
    });
    server.start();
  });

  afterEach(async () => {
    server.stop();
    await new Promise((r) => setTimeout(r, 100));
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  it("should successfully execute full multi-lane lifecycle: tasks, contract lock, shadow diffs & critique approval", async () => {
    // 1. Issue tokens for backend and frontend lanes
    const backendToken = server.issueInvite("backend");
    const frontendToken = server.issueInvite("frontend");

    // 2. Boot Backend Contributor Daemon
    const backendClient = new DaemonClient({
      url: `ws://localhost:${PORT}`,
      node_id: "rohan-laptop",
      lane: "backend",
      join_token: backendToken,
      workspace_path: backendDir,
      heartbeatIntervalMs: 500,
      autoReconnect: false
    });

    const snapshotPromise = new Promise((resolve) => {
      backendClient.onSnapshot = (s) => resolve(s);
    });

    await backendClient.connect();
    const snapshot = await snapshotPromise;
    expect(snapshot).toBeDefined();

    // 3. Backend claims task-auth-01
    server.getTaskBoard().claimTask("task-auth-01", "Rohan");
    const taskAuth = server.getTaskBoard().getTask("task-auth-01");
    expect(taskAuth?.status).toBe("active");
    expect(taskAuth?.assigned_to).toBe("Rohan");

    // 4. Backend acquires lease lock on CONTRACT/api.md
    const lockAcquired = server.getMutex().acquire("CONTRACT/api.md", "rohan-laptop", 10);
    expect(lockAcquired).toBe(true);

    // 5. Backend updates contract to include login endpoint and releases lock
    const updatedContract = "# Core API Contract v2\nPOST /api/v1/auth/login { email, password } -> { token: string }\n";
    const entry = server.getContractStore().update("CONTRACT/api.md", updatedContract);
    expect(entry.version).toBe(1);

    const released = server.getMutex().release("CONTRACT/api.md", "rohan-laptop");
    expect(released).toBe(true);

    // 6. Frontend Contributor Joins
    const frontendPeers = new PeersIndexManager(frontendDir);
    frontendPeers.setPeer({
      nodeId: "rohan-laptop",
      lane: "backend",
      status: "active",
      activeFile: "src/routes/auth.ts"
    });

    const peersContent = fs.readFileSync(frontendPeers.getPeersFilePath(), "utf8");
    expect(peersContent).toContain("`rohan-laptop`");
    expect(peersContent).toContain("`src/routes/auth.ts`");
    expect(peersContent).toContain(".nucleus/shadows/backend/");

    // 7. Backend writes code diff into shadow mirror for Frontend to inspect
    const shadowMirror = new ShadowMirror(frontendDir);
    const backendCode = `export function login(email, password) { return { token: "fake-jwt-token" }; }`;
    const syncResult = shadowMirror.applySync({
      source_lane: "backend",
      file_path: "src/routes/auth.ts",
      content: backendCode,
      version: 1
    });
    expect(syncResult.applied).toBe(true);

    const mirroredFile = path.join(frontendDir, ".nucleus", "shadows", "backend", "src", "routes", "auth.ts");
    expect(fs.existsSync(mirroredFile)).toBe(true);
    expect(fs.readFileSync(mirroredFile, "utf8")).toBe(backendCode);

    // 8. Backend submits task for review
    server.getTaskBoard().updateStatus("task-auth-01", "in_review");

    // 9. Critique Gate Evaluation
    const criticPipeline = new AICriticPipeline();
    const diff = `+ export function login(email: string, password: string) { return { token: "token-123" }; }`;

    const { result, markdown } = await criticPipeline.evaluate({
      taskId: "task-auth-01",
      lane: "backend",
      spec: taskAuth!.title,
      diff,
      deterministicChecksPassed: true,
      deterministicOutputs: ["Typecheck passed: 0 errors", "Vitest: 4 tests passed"]
    });

    expect(result.verdict).toBe("approved");
    expect(result.deterministic_checks_passed).toBe(true);
    expect(markdown).toContain("**Verdict:** APPROVED");

    // 10. Approve task on board
    server.getTaskBoard().updateStatus("task-auth-01", "approved");
    expect(server.getTaskBoard().getTask("task-auth-01")?.status).toBe("approved");

    // 11. Clean disconnect
    backendClient.sever();
  });
});
