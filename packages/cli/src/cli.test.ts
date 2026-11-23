import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseCli, InitRunner, JoinRunner } from "./index.js";
import fs from "node:fs";

const TEST_PORT = 9015;
const BASE_TEST_DIR = "./test_cli_runner_dir";

describe("Milestone 5: Developer CLI & Room Runner Integration", () => {
  const hostWs = `${BASE_TEST_DIR}/host_workspace`;
  const joinerWs = `${BASE_TEST_DIR}/joiner_workspace`;

  beforeEach(() => {
    fs.mkdirSync(hostWs, { recursive: true });
    fs.mkdirSync(joinerWs, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(BASE_TEST_DIR, { recursive: true, force: true });
  });

  it("CLI ARG PARSING: correctly parses commands and options", () => {
    const initArgs = parseCli(["init", "--port", "9999", "--room", "alpha-room"]);
    expect(initArgs.command).toBe("init");
    expect(initArgs.port).toBe(9999);
    expect(initArgs.roomId).toBe("alpha-room");

    const joinArgs = parseCli(["join", "-u", "ws://localhost:9999", "-t", "tok123", "-l", "backend"]);
    expect(joinArgs.command).toBe("join");
    expect(joinArgs.url).toBe("ws://localhost:9999");
    expect(joinArgs.token).toBe("tok123");
    expect(joinArgs.lane).toBe("backend");

    const helpArgs = parseCli(["--help"]);
    expect(helpArgs.command).toBe("help");
  });

  it("E2E CLI RUNNER: Host room with InitRunner and connect via JoinRunner", async () => {
    const host = new InitRunner({
      port: TEST_PORT,
      roomId: "cli-test-room",
      workspaceRoot: hostWs
    });

    const { inviteCommand } = host.start();

    // Verify CONTRACT and .nucleus were scaffolded
    expect(fs.existsSync(`${hostWs}/CONTRACT/api.md`)).toBe(true);
    expect(fs.existsSync(`${hostWs}/.nucleus`)).toBe(true);

    // Issue invite for backend lane
    const beCmd = inviteCommand("backend");
    expect(beCmd).toContain("nucleus join");
    expect(beCmd).toContain("--lane backend");

    // Extract token from command
    const tokenMatch = beCmd.match(/--token\s+([a-f0-9]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    // Join with JoinRunner
    const joiner = new JoinRunner({
      url: `ws://localhost:${TEST_PORT}`,
      token,
      lane: "backend",
      workspaceRoot: joinerWs
    });

    const client = await joiner.start();
    expect(client).toBeDefined();

    // Verify .nucleus/PEERS.md created in joiner workspace
    expect(fs.existsSync(`${joinerWs}/.nucleus/PEERS.md`)).toBe(true);
    const peersMd = fs.readFileSync(`${joinerWs}/.nucleus/PEERS.md`, "utf8");
    expect(peersMd).toContain("# Active Room Peers & Live Shadow Directory");

    joiner.stop();
    host.stop();
    await new Promise((r) => setTimeout(r, 100));
  });
});
