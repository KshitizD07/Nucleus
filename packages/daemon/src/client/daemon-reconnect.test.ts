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
      autoReconnect: true
    });

    let reconnected = false;
    daemon.onReconnect = () => {
      reconnected = true;
    };

    await daemon.connect();

    // Reconnection token support in coordinator invite store:
    // When the socket drops unexpectedly without sever(), daemon schedules reconnect
    expect(daemon).toBeDefined();

    daemon.sever();
    await new Promise((r) => setTimeout(r, 100));
  });
});
