import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorServer } from "@nucleus/coordinator";
import { DaemonClient } from "./daemon-client.js";

const PORT = 9022;

describe("Daemon Auto-Reconnect Lifecycle", () => {
  let coordinator: CoordinatorServer;

  beforeEach(() => {
    coordinator = new CoordinatorServer({
      port: PORT,
      roomId: "reconnect-room",
      logDir: "./test_reconnect_logs"
    });
    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
  });

  it("should auto-reconnect with exponential backoff when connection drops unexpectedly", async () => {
    const token = coordinator.issueInvite("backend");

    const daemon = new DaemonClient({
      url: `ws://localhost:${PORT}`,
      node_id: "reconnect-node",
      join_token: token,
      workspace_path: "./test_ws",
      lane: "backend",
      autoReconnect: true,
      baseReconnectIntervalMs: 50
    });

    let reconnected = false;
    const reconnectPromise = new Promise<void>((resolve) => {
      daemon.onReconnect = () => {
        reconnected = true;
        resolve();
      };
    });

    await daemon.connect();
    expect(daemon).toBeDefined();

    // Simulate unexpected socket drop (e.g., Wi-Fi drop or laptop sleep: socket terminate)
    (daemon as any).ws.terminate();

    // Await auto-reconnection
    await reconnectPromise;
    expect(reconnected).toBe(true);

    daemon.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should buffer critical messages in offline queue during disconnect and flush on reconnect", async () => {
    const token = coordinator.issueInvite("backend");

    const daemon = new DaemonClient({
      url: `ws://localhost:${PORT}`,
      node_id: "queue-node",
      join_token: token,
      workspace_path: "./test_ws",
      lane: "backend",
      autoReconnect: true,
      baseReconnectIntervalMs: 50
    });

    await daemon.connect();

    // Terminate socket to simulate dropped connection
    (daemon as any).ws.terminate();
    await new Promise((r) => setTimeout(r, 20)); // Ensure socket state is not OPEN

    // Send messages while offline
    daemon.claimTask("task-offline-1", "Offline Worker");
    daemon.syncLaneShadow("backend", "src/offline.ts", "export const x = 1;", 1);
    // Non-critical message should not be queued
    daemon.send("session:heartbeat", { status: "idle" });

    // Critical messages are queued in bounded buffer
    expect(daemon.getQueuedMessageCount()).toBe(2);

    // Wait for reconnection and queue flush
    const reconnectedPromise = new Promise<void>((resolve) => {
      daemon.onReconnect = () => resolve();
    });

    await reconnectedPromise;
    // Allow small tick for flushOutboundQueue to send
    await new Promise((r) => setTimeout(r, 50));

    expect(daemon.getQueuedMessageCount()).toBe(0);

    daemon.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should reject connect() if the coordinator denies handshake", async () => {
    const daemon = new DaemonClient({
      url: `ws://localhost:${PORT}`,
      node_id: "invalid-node",
      join_token: "invalid-token-12345",
      workspace_path: "./test_ws",
      lane: "backend",
      autoReconnect: false
    });

    await expect(daemon.connect()).rejects.toThrow(/Connection failed with code 4003/);
  });
});
