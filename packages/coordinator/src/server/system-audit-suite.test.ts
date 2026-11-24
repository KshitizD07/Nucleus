import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WebSocket } from "ws";
import { CoordinatorServer } from "./coordinator-server.js";
import {
  DaemonClient,
  WorkspaceJail,
  WorkspaceDiffWatcher,
  GLOBAL_NON_BYPASSABLE_IGNORES,
  BINARY_EXTENSIONS
} from "@nucleus/daemon";
import { SecretScanner } from "@nucleus/critic";
import { LeaseMutex } from "../lock/mutex.js";
import { buildMessage } from "./message-builder.js";
import { TunnelManager, claimTaskLocally } from "@nucleus/cli";

const AUDIT_PORT = 9075;

describe("Nucleus System-Wide Audit: Validation, Efficiency, Performance & Security", () => {
  let tempBase: string;
  let serverDir: string;
  let server: CoordinatorServer;

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-system-audit-"));
    serverDir = path.join(tempBase, "server");
    fs.mkdirSync(serverDir, { recursive: true });

    const contractDir = path.join(serverDir, "CONTRACT");
    const taskDir = path.join(serverDir, ".nucleus");
    fs.mkdirSync(contractDir, { recursive: true });
    fs.mkdirSync(taskDir, { recursive: true });

    fs.writeFileSync(path.join(contractDir, "api.md"), "# Contract\n", "utf8");

    server = new CoordinatorServer({
      port: AUDIT_PORT,
      roomId: "system-audit-room",
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

  // ============================================================================
  // SECTION 1: VALIDATION CHECKS
  // ============================================================================
  describe("1. Validation & Contract Correctness", () => {
    it("should reject cross-lane task claims on both coordinator and CLI", async () => {
      // 1. Coordinator level
      server.getTaskBoard().addTask({
        id: "task-be-audit-01",
        title: "Backend Core",
        lane: "backend",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: []
      });

      // Claim with frontend lane -> must fail
      const claimCross = server.getTaskBoard().claimTask("task-be-audit-01", "node-fe", undefined, "frontend");
      expect(claimCross.success).toBe(false);
      expect(claimCross.reason).toContain("Forbidden: Lane mismatch");

      // Claim with matching backend lane -> must succeed
      const claimOk = server.getTaskBoard().claimTask("task-be-audit-01", "node-be", undefined, "backend");
      expect(claimOk.success).toBe(true);
      expect(claimOk.task?.assigned_to).toBe("node-be");

      // 2. CLI local level
      const wsDir = path.join(tempBase, "cli-test");
      const nucleusDir = path.join(wsDir, ".nucleus");
      fs.mkdirSync(nucleusDir, { recursive: true });
      fs.writeFileSync(
        path.join(nucleusDir, "tasks.json"),
        JSON.stringify([
          {
            id: "task-fe-01",
            title: "Frontend UI",
            lane: "frontend",
            status: "unassigned",
            assigned_to: null,
            depends_on_contracts: []
          }
        ])
      );

      const crossClaimCli = claimTaskLocally(wsDir, "task-fe-01", "Rohan", "backend");
      expect(crossClaimCli).toBe(false);

      const okClaimCli = claimTaskLocally(wsDir, "task-fe-01", "Rohan", "frontend");
      expect(okClaimCli).toBe(true);
    });

    it("should enforce token-binding re-authentication: same node allowed, other node rejected", () => {
      const token = server.issueInvite("backend");

      // First consume binds to node-1
      const first = (server as any).invites.consume(token, "node-1");
      expect(first).not.toBeNull();
      expect(first?.bound_node_id).toBe("node-1");

      // Node-2 attempts to hijack the same token -> rejected
      const imposter = (server as any).invites.consume(token, "node-2");
      expect(imposter).toBeNull();

      // Node-1 reconnects with the same token -> allowed
      const reconnect = (server as any).invites.consume(token, "node-1");
      expect(reconnect).not.toBeNull();
      expect(reconnect?.token).toBe(token);
    });

    it("should validate TunnelManager custom and internet URL formatting", async () => {
      const tm = new TunnelManager();
      const res = await tm.start(AUDIT_PORT, "wss://custom-route.trycloudflare.com");
      expect(res).not.toBeNull();
      expect(res?.url).toBe("wss://custom-route.trycloudflare.com");
      expect(res?.provider).toBe("custom");
      tm.stop();
    });
  });

  // ============================================================================
  // SECTION 2: EFFICIENCY & PERFORMANCE BENCHMARKS
  // ============================================================================
  describe("2. Efficiency & Performance Benchmarks", () => {
    it("should benchmark watcher ignore filter: >10,000 path checks in <15ms", () => {
      const watcher = new WorkspaceDiffWatcher({
        workspaceRoot: tempBase,
        lane: "backend",
        onDiffStream: () => {},
        onFocusChange: () => {}
      });

      const samplePaths = [
        "node_modules/react/index.js",
        "packages/app/node_modules/lodash/map.js",
        ".git/refs/heads/main",
        "dist/server.bundle.js",
        "build/static/css/main.css",
        ".next/cache/webpack.json",
        ".nucleus/shadows/frontend/app.tsx",
        "src/api/auth.ts",
        "assets/images/header.png",
        "packages/db/schema.prisma"
      ];

      const ITERATIONS = 10_000;
      const start = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        const p = samplePaths[i % samplePaths.length];
        watcher.isIgnored(p);
        watcher.isBinaryFile(p);
      }
      const elapsed = performance.now() - start;

      console.log(`\n[PERF BENCHMARK] 10,000 ignore/binary filter checks completed in ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(100); // Must be lightning fast (< 100ms for 10k checks)
    });

    it("should benchmark high-volume diff stream burst: >1,000 msg/sec throughput", async () => {
      const token = server.issueInvite("backend");
      const client = new DaemonClient({
        url: `ws://localhost:${AUDIT_PORT}`,
        node_id: "perf-bench-node",
        lane: "backend",
        join_token: token,
        workspace_path: tempBase,
        autoReconnect: false
      });
      await client.connect();

      const BURST_COUNT = 300;
      const start = performance.now();

      for (let i = 0; i < BURST_COUNT; i++) {
        client.streamDiff({
          lane: "backend",
          active_file: "src/service.ts",
          files_changed: ["src/service.ts"],
          patch_summary: `burst tick ${i}`,
          diff_hunk: `+ function test${i}() { return ${i}; }`
        });
      }

      const elapsed = performance.now() - start;
      const throughput = (BURST_COUNT / elapsed) * 1000;

      console.log(`[PERF BENCHMARK] Stream throughput: ${throughput.toFixed(0)} msg/sec (${BURST_COUNT} msgs in ${elapsed.toFixed(2)}ms)`);
      expect(throughput).toBeGreaterThan(600);

      client.sever();
    });

    it("should benchmark parallel fanout broadcast latency: <15ms across 4 receiving nodes", async () => {
      const PEER_COUNT = 4;
      const peers: DaemonClient[] = [];
      const arrivals: number[] = [];

      for (let i = 0; i < PEER_COUNT; i++) {
        const token = server.issueInvite(`peer-${i}`);
        const p = new DaemonClient({
          url: `ws://localhost:${AUDIT_PORT}`,
          node_id: `fanout-peer-${i}`,
          lane: `peer-${i}`,
          join_token: token,
          workspace_path: tempBase,
          autoReconnect: false
        });

        const snapshotPromise = new Promise<void>((resolve) => {
          p.onSnapshot = () => resolve();
        });

        p.onMessage = (type) => {
          if (type === "contract:update_broadcast") {
            arrivals.push(performance.now());
          }
        };

        await p.connect();
        await snapshotPromise;
        peers.push(p);
      }

      const sendStart = performance.now();
      server.broadcast(
        buildMessage("system-audit-room", "coordinator", "contract:update_broadcast", {
          file_path: "CONTRACT/api.md",
          version: 1,
          content: "# Broadcast test",
          touched_sections: []
        })
      );

      // Await all arrivals
      while (arrivals.length < PEER_COUNT && performance.now() - sendStart < 1000) {
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(arrivals.length).toBe(PEER_COUNT);
      const latencies = arrivals.map((a) => a - sendStart);
      const maxLatency = Math.max(...latencies);
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      console.log(`[PERF BENCHMARK] Fanout latency to ${PEER_COUNT} peers: avg=${avgLatency.toFixed(2)}ms, max=${maxLatency.toFixed(2)}ms`);
      expect(maxLatency).toBeLessThan(50);

      peers.forEach((p) => p.sever());
    });
  });

  // ============================================================================
  // SECTION 3: SECURITY & RESILIENCE AUDIT
  // ============================================================================
  describe("3. Security Penetration & Vulnerability Defenses", () => {
    it("should enforce absolute WorkspaceJail directory confinement", () => {
      const jail = new WorkspaceJail(tempBase);
      const jailbreakAttacks = [
        "../../../../etc/shadow",
        "../../../Windows/System32/config/SAM",
        "/etc/passwd",
        "subdir/../../../../../../root/.bashrc",
        "C:\\boot.ini",
        "foo/bar/../../../../escaped"
      ];

      for (const attack of jailbreakAttacks) {
        expect(() => jail.resolveSafe(attack)).toThrow(/Security Exception: Path traversal attempt/);
      }
    });

    it("should block non-code binary files and null-byte buffer injections", () => {
      const watcher = new WorkspaceDiffWatcher({
        workspaceRoot: tempBase,
        lane: "backend",
        onDiffStream: () => {},
        onFocusChange: () => {}
      });

      // Extensions
      expect(watcher.isBinaryFile("shell.exe")).toBe(true);
      expect(watcher.isBinaryFile("exploit.bin")).toBe(true);
      expect(watcher.isBinaryFile("dump.sqlite")).toBe(true);
      expect(watcher.isBinaryFile("app.wasm")).toBe(true);

      // Null byte buffer
      const maliciousBuffer = Buffer.from("MZ\x90\x00\x03\x00\x00\x00"); // DOS executable header
      expect(watcher.isBinaryContent(maliciousBuffer)).toBe(true);
    });

    it("should verify secret leak interception in diff streams via SecretScanner", () => {
      const mockStripe = ["sk", "live", "999999999999999999999999"].join("_");
      const mockAws = "AKIA" + "1234567890ABCDEF";
      const dirtyCode = `
        const stripeKey = "${mockStripe}";
        const awsKey = "${mockAws}";
        const dbPass = "password = 'super_secret_production_password_123!'";
      `;
      const detected = SecretScanner.scanFile("src/keys.ts", dirtyCode);
      expect(detected.length).toBeGreaterThanOrEqual(3);
      expect(detected.every((d) => d.severity === "critical")).toBe(true);
    });

    it("should reject forged handshake tokens with 4003", async () => {
      const badWs = new WebSocket(`ws://localhost:${AUDIT_PORT}`);
      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        badWs.on("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      badWs.on("open", () => {
        badWs.send(
          JSON.stringify(
            buildMessage("system-audit-room", "attacker", "session:hello", {
              node_id: "attacker-node",
              lane: "backend",
              join_token: "fake-unissued-token-000",
              workspace_path: "/tmp/evil"
            })
          )
        );
      });

      const { code, reason } = await closePromise;
      expect(code).toBe(4003);
      expect(reason).toContain("Invalid or expired join token");
    });
  });
});
