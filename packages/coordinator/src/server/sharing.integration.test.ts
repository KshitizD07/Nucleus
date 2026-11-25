import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinatorServer } from "../server/coordinator-server.js";
import { DaemonClient, PeersIndexManager, ShadowMirror, WorkspaceDiffWatcher } from "@nucleus/daemon";
import fs from "node:fs";
import path from "node:path";

const TEST_PORT = 9006;
const TEST_ROOM = "test-sharing-room";
const LOG_DIR = "./test_logs_sharing";
const BE_WORKSPACE = "./test_ws_backend";
const FE_WORKSPACE = "./test_ws_frontend";

describe("Milestone 3: Live Diff Streaming, Shadows & Agent Context (.nucleus/PEERS.md)", () => {
  let coordinator: CoordinatorServer;

  beforeEach(() => {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.mkdirSync(BE_WORKSPACE, { recursive: true });
    fs.mkdirSync(FE_WORKSPACE, { recursive: true });

    coordinator = new CoordinatorServer({
      port: TEST_PORT,
      roomId: TEST_ROOM,
      logDir: LOG_DIR
    });
    coordinator.start();
  });

  afterEach(() => {
    coordinator.stop();
    fs.rmSync(LOG_DIR, { recursive: true, force: true });
    fs.rmSync(BE_WORKSPACE, { recursive: true, force: true });
    fs.rmSync(FE_WORKSPACE, { recursive: true, force: true });
  });

  it("should update .nucleus/PEERS.md on peer join and active file focus", async () => {
    const tokenBE = coordinator.issueInvite("backend");
    const tokenFE = coordinator.issueInvite("frontend");

    const fePeersMgr = new PeersIndexManager(FE_WORKSPACE);

    const daemonBE = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-be",
      join_token: tokenBE,
      workspace_path: BE_WORKSPACE,
      lane: "backend"
    });

    const daemonFE = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-fe",
      join_token: tokenFE,
      workspace_path: FE_WORKSPACE,
      lane: "frontend"
    });

    await daemonBE.connect();
    await daemonFE.connect();

    // Frontend daemon listens to peer events and updates .nucleus/PEERS.md
    daemonFE.onMessage = (type, payload: any) => {
      if (type === "session:peer_joined") {
        fePeersMgr.setPeer({
          nodeId: payload.node_id,
          lane: payload.lane,
          status: "idle",
          activeFile: null
        });
      } else if (type === "sharing:file_focus_change") {
        fePeersMgr.updatePeerFocus(
          payload.lane, // or node
          payload.action === "idle" ? null : payload.file_path,
          payload.action === "editing" ? "active" : "idle"
        );
      }
    };

    // Simulate backend starting edit on src/auth/jwt.ts
    daemonBE.notifyFocusChange("src/auth/jwt.ts", "editing");
    await new Promise((r) => setTimeout(r, 100));

    // Inspect FE's .nucleus/PEERS.md
    const peersMdContent = fs.readFileSync(fePeersMgr.getPeersFilePath(), "utf8");
    expect(peersMdContent).toContain("# Active Room Peers & Live Shadow Directory");
    expect(peersMdContent).toContain(".nucleus/shadows/");

    daemonBE.sever();
    daemonFE.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should mirror live file into peer shadow directory without Git commits", async () => {
    const tokenBE = coordinator.issueInvite("backend");
    const tokenFE = coordinator.issueInvite("frontend");

    const feShadowMirror = new ShadowMirror(FE_WORKSPACE);

    const daemonBE = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-be",
      join_token: tokenBE,
      workspace_path: BE_WORKSPACE,
      lane: "backend"
    });

    const daemonFE = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-fe",
      join_token: tokenFE,
      workspace_path: FE_WORKSPACE,
      lane: "frontend"
    });

    await daemonBE.connect();
    await daemonFE.connect();

    // FE listener applies shadow syncs
    daemonFE.onMessage = (type, payload: any) => {
      if (type === "sharing:lane_shadow_sync") {
        feShadowMirror.applySync(payload);
      }
    };

    // BE syncs a live uncommitted API controller file
    const controllerCode = "export interface LoginResponse { token: string; user: { id: string } };";
    daemonBE.syncLaneShadow("backend", "src/auth/auth.controller.ts", controllerCode, 1);

    await new Promise((r) => setTimeout(r, 100));

    // Verify FE local disk has the exact uncommitted file under .nucleus/shadows/backend/
    const mirrored = feShadowMirror.readShadowFile("backend", "src/auth/auth.controller.ts");
    expect(mirrored).toBe(controllerCode);

    daemonBE.sever();
    daemonFE.sever();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("should watch workspace changes and stream live diff frames", async () => {
    let capturedDiff: any = null;

    const diffWatcher = new WorkspaceDiffWatcher({
      workspaceRoot: BE_WORKSPACE,
      lane: "backend",
      debounceMs: 50,
      onDiffStream: (diff) => {
        capturedDiff = diff;
      },
      onFocusChange: () => {}
    });

    diffWatcher.start();

    // Create a new source file in BE workspace
    const srcDir = path.join(BE_WORKSPACE, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const targetFile = path.join(srcDir, "service.ts");
    fs.writeFileSync(targetFile, "export const add = (a: number, b: number) => a + b;\n", "utf8");

    // Wait for debounced watcher
    await new Promise((r) => setTimeout(r, 200));

    expect(capturedDiff).not.toBeNull();
    expect(capturedDiff.lane).toBe("backend");
    expect(capturedDiff.active_file).toContain("service.ts");
    expect(capturedDiff.patch_summary).toContain("lines in service.ts");

    diffWatcher.stop();
  });

  it("should drop unauthorized client message types and reconstruct authoritative sender identity", async () => {
    const tokenBE = coordinator.issueInvite("backend");
    const tokenFE = coordinator.issueInvite("frontend");

    const daemonBE = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-be-legit",
      join_token: tokenBE,
      workspace_path: BE_WORKSPACE,
      lane: "backend"
    });

    const daemonFE = new DaemonClient({
      url: `ws://localhost:${TEST_PORT}`,
      node_id: "node-fe-listener",
      join_token: tokenFE,
      workspace_path: FE_WORKSPACE,
      lane: "frontend"
    });

    await daemonBE.connect();
    await daemonFE.connect();

    const receivedMessages: { type: string; envelope?: any }[] = [];
    (daemonFE as any).ws.on("message", (raw: string) => {
      try {
        const parsed = JSON.parse(raw);
        receivedMessages.push({ type: parsed.type, envelope: parsed });
      } catch {}
    });

    // 1. Attacker sends unauthorized fake server event
    daemonBE.send("session:peer_joined", { node_id: "ghost", lane: "hacked" });
    daemonBE.send("custom:unauthorized_event", { data: "malicious" });

    // 2. Attacker sends live diff with spoofed node_id & room_id
    (daemonBE as any).ws.send(JSON.stringify({
      room_id: "spoofed-room",
      node_id: "spoofed-admin",
      ts: Date.now(),
      type: "sharing:live_diff_stream",
      payload: {
        lane: "backend",
        active_file: "test.ts",
        files_changed: ["test.ts"],
        patch_summary: "+1",
        diff_hunk: "hello"
      },
      sig: ""
    }));

    await new Promise((r) => setTimeout(r, 150));

    // Fake events must NEVER be forwarded
    const fakePeer = receivedMessages.find((m) => m.type === "session:peer_joined" && m.envelope?.payload?.node_id === "ghost");
    expect(fakePeer).toBeUndefined();

    const customEvent = receivedMessages.find((m) => m.type === "custom:unauthorized_event");
    expect(customEvent).toBeUndefined();

    // The legitimate diff was forwarded, but with server-authoritative node_id and room_id!
    const forwardedDiff = receivedMessages.find((m) => m.type === "sharing:live_diff_stream");
    expect(forwardedDiff).toBeDefined();
    expect(forwardedDiff?.envelope.node_id).toBe("node-be-legit"); // Bound from authenticated socket!
    expect(forwardedDiff?.envelope.room_id).toBe(TEST_ROOM);      // Bound from server room!

    daemonBE.sever();
    daemonFE.sever();
    await new Promise((r) => setTimeout(r, 100));
  });
});
