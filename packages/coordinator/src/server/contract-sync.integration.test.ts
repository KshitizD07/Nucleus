import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorServer } from "../server/coordinator-server.js";
import { DaemonClient, ContractReplica } from "@nucleus/daemon";
import fs from "node:fs";
import path from "node:path";

const TEST_PORT = 9002;
const TEST_ROOM = "test-contract-room";
const LOG_DIR = "./test_logs_contracts";
const COORD_CONTRACT_DIR = "./test_coord_contracts";
const DAEMON_WORKSPACE = "./test_daemon_workspace";

describe("Milestone 2: Contract Synchronization & Lease Locks", () => {
  let coordinator: CoordinatorServer;

  beforeEach(() => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.mkdirSync(COORD_CONTRACT_DIR, { recursive: true });
    fs.mkdirSync(DAEMON_WORKSPACE, { recursive: true });

    coordinator = new CoordinatorServer({
      port: TEST_PORT,
      roomId: TEST_ROOM,
      logDir: LOG_DIR,
      contractDir: COORD_CONTRACT_DIR
    });
    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
    fs.rmSync(COORD_CONTRACT_DIR, { recursive: true, force: true });
    fs.rmSync(DAEMON_WORKSPACE, { recursive: true, force: true });
  });

  it("should grant contract lock to requester and deny to second node", async () => {
    const token1 = coordinator.issueInvite("backend");
    const token2 = coordinator.issueInvite("frontend");

    const daemon1 = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-be",
      join_token: token1,
      workspace_path: DAEMON_WORKSPACE,
      lane: "backend"
    });

    const daemon2 = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-fe",
      join_token: token2,
      workspace_path: DAEMON_WORKSPACE,
      lane: "frontend"
    });

    await daemon1.connect();
    await daemon2.connect();

    // Node 1 requests lock on api.md
    const grantPromise = new Promise<any>((resolve) => {
      daemon1.onMessage = (type, payload) => {
        if (type === "contract:lock_grant") resolve(payload);
      };
    });

    daemon1.requestContractLock("api.md", 15);
    const grant = await grantPromise;
    expect(grant.file_path).toBe("api.md");
    expect(grant.holder_id).toBe("node-be");

    // Node 2 tries to acquire the same lock -> denied
    const denyPromise = new Promise<any>((resolve) => {
      daemon2.onMessage = (type, payload) => {
        if (type === "contract:lock_denied") resolve(payload);
      };
    });

    daemon2.requestContractLock("api.md", 15);
    const denial = await denyPromise;
    expect(denial.file_path).toBe("api.md");
    expect(denial.held_by).toBe("node-be");

    daemon1.sever();
    daemon2.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should broadcast contract update to peers and update local replica", async () => {
    const token1 = coordinator.issueInvite("backend");
    const token2 = coordinator.issueInvite("frontend");

    const replica2 = new ContractReplica({ workspaceRoot: DAEMON_WORKSPACE });

    const daemon1 = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-author",
      join_token: token1,
      workspace_path: DAEMON_WORKSPACE,
      lane: "backend"
    });

    const daemon2 = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-listener",
      join_token: token2,
      workspace_path: DAEMON_WORKSPACE,
      lane: "frontend"
    });

    await daemon1.connect();
    await daemon2.connect();

    // Lock must be acquired before updating
    await new Promise<void>((resolve) => {
      daemon1.onMessage = (type) => {
        if (type === "contract:lock_grant") resolve();
      };
      daemon1.requestContractLock("schema.prisma", 15);
    });

    // Node 2 listens for update broadcast
    const broadcastPromise = new Promise<any>((resolve) => {
      daemon2.onMessage = (type, payload) => {
        if (type === "contract:update") resolve(payload);
      };
    });

    const newSchemaContent = "model User { id String @id }";
    daemon1.publishContractUpdate("schema.prisma", newSchemaContent, ["User"]);

    const broadcast = await broadcastPromise;
    expect(broadcast.file_path).toBe("schema.prisma");
    expect(broadcast.version).toBe(1);
    expect(broadcast.content).toBe(newSchemaContent);

    // Apply into listener's replica
    const res = replica2.applyUpdate(broadcast);
    expect(res.applied).toBe(true);
    expect(replica2.getVersion("schema.prisma")).toBe(1);
    expect(replica2.readFile("schema.prisma")).toBe(newSchemaContent);

    daemon1.sever();
    daemon2.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should reject contract lock requests and updates attempting path traversal outside contract directory", async () => {
    const token = coordinator.issueInvite("backend");

    const daemon = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-attacker",
      join_token: token,
      workspace_path: DAEMON_WORKSPACE,
      lane: "backend"
    });

    await daemon.connect();

    const denyPromise = new Promise<any>((resolve) => {
      daemon.onMessage = (type, payload) => {
        if (type === "contract:lock_denied") resolve(payload);
      };
    });

    // Attempt to acquire lock on path traversal
    daemon.requestContractLock("../../package.json", 15);
    const denial = await denyPromise;
    expect(denial.file_path).toBe("../../package.json");
    expect(denial.held_by).toBe("system:invalid_path");

    // Direct contract store path traversal check
    expect(() => coordinator.getContractStore().update("../../secret.env", "hacked=true")).toThrow(
      /Security Exception.*Contract path traversal/
    );

    // Verify file was never written outside
    expect(fs.existsSync(path.resolve(COORD_CONTRACT_DIR, "../../secret.env"))).toBe(false);

    daemon.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should persist contract versions across ContractStore restarts using durable manifest", () => {
    const store1 = coordinator.getContractStore();
    store1.update("api.md", "# Version 1");
    store1.update("api.md", "# Version 2");
    const entry = store1.update("api.md", "# Version 3");
    expect(entry.version).toBe(3);

    // Simulate coordinator restart by instantiating a new ContractStore on the same directory
    const store2 = new (store1.constructor as any)(COORD_CONTRACT_DIR);
    expect(store2.currentVersion("api.md")).toBe(3);
    expect(store2.get("api.md")?.content).toBe("# Version 3");

    // Next update should increment to 4
    const nextEntry = store2.update("api.md", "# Version 4");
    expect(nextEntry.version).toBe(4);
  });
});
