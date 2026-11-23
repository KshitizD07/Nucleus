import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorServer } from "../server/coordinator-server.js";
import { DaemonClient } from "@nucleus/daemon";

const TEST_PORT = 9001;
const TEST_ROOM = "test-room-1";
const LOG_DIR = "./test_logs";

describe("Coordinator <-> Daemon Integration: Join Handshake", () => {
  let coordinator: CoordinatorServer;

  beforeEach(() => {
    coordinator = new CoordinatorServer({
      port: TEST_PORT,
      roomId: TEST_ROOM,
      logDir: LOG_DIR
    });
    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
  });

  it("should complete the full join handshake and receive room_snapshot", async () => {
    const token = coordinator.issueInvite("backend");

    const daemon = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "test-node-1",
      join_token: token,
      workspace_path: "/test/workspace",
      lane: "backend",
      heartbeatIntervalMs: 500
    });

    const snapshot = await new Promise<unknown>((resolve) => {
      daemon.onSnapshot = (s) => resolve(s);
      daemon.connect();
    });

    expect(snapshot).toBeDefined();
    expect((snapshot as { room_id: string }).room_id).toBe(TEST_ROOM);

    daemon.sever();
    // allow graceful close
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should reject a connection with an invalid join token", async () => {
    const daemon = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "bad-node",
      join_token: "invalid-token-xyz",
      workspace_path: "/test/workspace",
      lane: "frontend"
    });

    const reason = await new Promise<string>((resolve) => {
      daemon.onDisconnect = resolve;
      daemon.connect();
    });

    expect(reason).toBeTruthy();
  });
});
