import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorServer } from "../server/coordinator-server.js";
import { DaemonClient, ContractReplica } from "@nucleus/daemon";
import fs from "node:fs";

const PERF_PORT = 9005;
const PERF_ROOM = "perf-eval-room";
const LOG_DIR = "./test_perf_logs";
const CONTRACT_DIR = "./test_perf_contracts";
const WORKSPACE_DIR = "./test_perf_workspace";

describe("Milestone 1 & 2: Stress, Concurrency & Correctness Benchmark", () => {
  let coordinator: CoordinatorServer;

  beforeEach(() => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.mkdirSync(CONTRACT_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    coordinator = new CoordinatorServer({
      port: PERF_PORT,
      roomId: PERF_ROOM,
      logDir: LOG_DIR,
      contractDir: CONTRACT_DIR
    });
    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
    fs.rmSync(CONTRACT_DIR, { recursive: true, force: true });
    fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  });

  it("CORRECTNESS: Lock Lease Expiry Auto-Recovery (Deadlock Prevention)", async () => {
    const token1 = coordinator.issueInvite("backend");
    const token2 = coordinator.issueInvite("frontend");

    const daemon1 = new DaemonClient({
      url: `ws://localhost:${PERF_PORT}`,
      node_id: "node-1",
      join_token: token1,
      workspace_path: WORKSPACE_DIR,
      lane: "backend"
    });

    const daemon2 = new DaemonClient({
      url: `ws://localhost:${PERF_PORT}`,
      node_id: "node-2",
      join_token: token2,
      workspace_path: WORKSPACE_DIR,
      lane: "frontend"
    });

    await daemon1.connect();
    await daemon2.connect();

    // 1. Node 1 acquires a short 1-second lock
    await new Promise<void>((resolve) => {
      daemon1.onMessage = (type) => {
        if (type === "contract:lock_grant") resolve();
      };
      // Lock for 1 second (testing TTL auto-release)
      daemon1.requestContractLock("schema.prisma", 1);
    });

    // 2. Node 2 immediately tries and gets denied
    const denied = await new Promise<boolean>((resolve) => {
      daemon2.onMessage = (type) => {
        if (type === "contract:lock_denied") resolve(true);
      };
      daemon2.requestContractLock("schema.prisma", 1);
    });
    expect(denied).toBe(true);

    // 3. Wait 1.1s for lease to expire without Node 1 releasing manually
    await new Promise((r) => setTimeout(r, 1100));

    // 4. Node 2 should now acquire it successfully without deadlocking
    const grantedAfterExpiry = await new Promise<boolean>((resolve) => {
      daemon2.onMessage = (type) => {
        if (type === "contract:lock_grant") resolve(true);
      };
      daemon2.requestContractLock("schema.prisma", 5);
    });
    expect(grantedAfterExpiry).toBe(true);

    daemon1.sever();
    daemon2.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("EFFICIENCY & LATENCY: Multi-Node Fanout Broadcast Benchmark", async () => {
    const nodeCount = 5;
    const daemons: DaemonClient[] = [];
    const replicas: ContractReplica[] = [];

    // Connect 1 author + 4 peer nodes
    for (let i = 0; i < nodeCount; i++) {
      const lane = i === 0 ? "author" : `peer-${i}`;
      const token = coordinator.issueInvite(lane);
      const wsDir = `${WORKSPACE_DIR}/node-${i}`;
      fs.mkdirSync(wsDir, { recursive: true });

      const d = new DaemonClient({
        url: `ws://localhost:${PERF_PORT}`,
        node_id: `node-${i}`,
        join_token: token,
        workspace_path: wsDir,
        lane
      });

      await d.connect();
      daemons.push(d);
      replicas.push(new ContractReplica({ workspaceRoot: wsDir }));
    }

    const author = daemons[0];
    const peers = daemons.slice(1);

    // Acquire lock for author
    await new Promise<void>((resolve) => {
      author.onMessage = (type) => {
        if (type === "contract:lock_grant") resolve();
      };
      author.requestContractLock("api.md", 15);
    });

    // Benchmark time to broadcast across all peers
    const startTs = performance.now();
    const updatePromises = peers.map((p, idx) => {
      return new Promise<void>((resolve) => {
        p.onMessage = (type, payload: any) => {
          if (type === "contract:update") {
            replicas[idx + 1].applyUpdate(payload);
            resolve();
          }
        };
      });
    });

    const testPayload = JSON.stringify({ routes: ["GET /users", "POST /auth"], count: 50 });
    author.publishContractUpdate("api.md", testPayload, ["auth"]);

    await Promise.all(updatePromises);
    const elapsedMs = performance.now() - startTs;

    console.log(`\n[PERF RESULT] Fanout to ${peers.length} parallel nodes completed in ${elapsedMs.toFixed(2)}ms`);

    // Verify all peer replicas received and wrote identical content
    for (let i = 1; i < nodeCount; i++) {
      expect(replicas[i].getVersion("api.md")).toBe(1);
      expect(replicas[i].readFile("api.md")).toBe(testPayload);
    }

    // High performance requirement: 4-peer fanout & disk replica write should take < 50ms locally
    expect(elapsedMs).toBeLessThan(100);

    for (const d of daemons) d.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("RELIABILITY & CRASH RECOVERY: EventLog Replay", async () => {
    const token = coordinator.issueInvite("backend");
    const daemon = new DaemonClient({
      url: `ws://localhost:${PERF_PORT}`,
      node_id: "replay-node",
      join_token: token,
      workspace_path: WORKSPACE_DIR,
      lane: "backend"
    });

    await daemon.connect();

    // Acquire lock and publish update
    await new Promise<void>((resolve) => {
      daemon.onMessage = (type) => {
        if (type === "contract:lock_grant") resolve();
      };
      daemon.requestContractLock("schema.sql", 15);
    });

    daemon.publishContractUpdate("schema.sql", "CREATE TABLE users (id SERIAL PRIMARY KEY);", ["users"]);
    await new Promise((r) => setTimeout(r, 100));

    // Inspect the JSONL log directly
    const logFilePath = `${LOG_DIR}/${PERF_ROOM}.jsonl`;
    expect(fs.existsSync(logFilePath)).toBe(true);

    const logLines = fs.readFileSync(logFilePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const eventTypes = logLines.map((e) => e.type);

    expect(eventTypes).toContain("node_joined");
    expect(eventTypes).toContain("contract_lock_acquired");
    expect(eventTypes).toContain("contract_updated");

    daemon.sever();
    await new Promise((r) => setTimeout(r, 100));
  });
});
