import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseCli, InitRunner, JoinRunner, listTasks, claimTaskLocally, archiveCompletedTasksLocally } from "./index.js";
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
    const initArgs = parseCli(["init", "--port", "9999", "--room", "alpha-room", "--tunnel"]);
    expect(initArgs.command).toBe("init");
    expect(initArgs.port).toBe(9999);
    expect(initArgs.roomId).toBe("alpha-room");
    expect(initArgs.tunnel).toBe(true);

    const joinArgs = parseCli(["join", "-u", "ws://localhost:9999", "-t", "tok123", "-l", "backend", "-n", "Aryan"]);
    expect(joinArgs.command).toBe("join");
    expect(joinArgs.url).toBe("ws://localhost:9999");
    expect(joinArgs.token).toBe("tok123");
    expect(joinArgs.lane).toBe("backend");
    expect(joinArgs.name).toBe("Aryan");

    const taskArgs = parseCli(["tasks", "--lane", "backend"]);
    expect(taskArgs.command).toBe("tasks");
    expect(taskArgs.lane).toBe("backend");

    const claimArgs = parseCli(["claim", "task-auth-01", "--name", "Rohan"]);
    expect(claimArgs.command).toBe("claim");
    expect(claimArgs.taskId).toBe("task-auth-01");
    expect(claimArgs.name).toBe("Rohan");

    const helpArgs = parseCli(["--help"]);
    expect(helpArgs.command).toBe("help");
  });

  it("CLI TASK COMMANDS: claimTaskLocally updates .nucleus/tasks.json", () => {
    const nucleusDir = `${joinerWs}/.nucleus`;
    fs.mkdirSync(nucleusDir, { recursive: true });
    const initialTasks = [
      {
        id: "task-test-01",
        title: "Test Task",
        lane: "backend",
        status: "unassigned",
        assigned_to: null,
        depends_on_contracts: []
      }
    ];
    fs.writeFileSync(`${nucleusDir}/tasks.json`, JSON.stringify(initialTasks, null, 2), "utf8");

    const ok = claimTaskLocally(joinerWs, "task-test-01", "Rohan");
    expect(ok).toBe(true);

    const updated = JSON.parse(fs.readFileSync(`${nucleusDir}/tasks.json`, "utf8"));
    expect(updated[0].assigned_to).toBe("Rohan");
    expect(updated[0].status).toBe("active");

    // Reject claim on lane mismatch
    const rejected = claimTaskLocally(joinerWs, "task-test-01", "Alex", "frontend");
    expect(rejected).toBe(false);

    // Collision rejection: second contributor claims already claimed task
    const collisionRejected = claimTaskLocally(joinerWs, "task-test-01", "Harsh", "backend");
    expect(collisionRejected).toBe(false);

    // Update task to approved and verify archiving
    const currentTasks = JSON.parse(fs.readFileSync(`${nucleusDir}/tasks.json`, "utf8"));
    currentTasks[0].status = "approved";
    fs.writeFileSync(`${nucleusDir}/tasks.json`, JSON.stringify(currentTasks, null, 2), "utf8");

    const archiveResult = archiveCompletedTasksLocally(joinerWs);
    expect(archiveResult.archivedCount).toBe(1);
    expect(archiveResult.remainingCount).toBe(0);

    // Active board is now clean
    const activeRemaining = JSON.parse(fs.readFileSync(`${nucleusDir}/tasks.json`, "utf8"));
    expect(activeRemaining.length).toBe(0);

    // Archive file contains the completed task
    const archiveContent = JSON.parse(fs.readFileSync(`${nucleusDir}/tasks_archive.json`, "utf8"));
    expect(archiveContent.length).toBe(1);
    expect(archiveContent[0].id).toBe("task-test-01");
    expect(archiveContent[0].status).toBe("approved");
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

  it("ZERO-CONFIG TUNNELING: TunnelManager and InitRunner with --tunnel", async () => {
    const host = new InitRunner({
      port: 9879,
      roomId: "tunnel-test-room",
      workspaceRoot: hostWs,
      tunnel: true,
      tunnelUrl: "wss://alpha-custom.trycloudflare.com"
    });

    const tunnelUrl = await host.startTunnel();
    expect(tunnelUrl).toBe("wss://alpha-custom.trycloudflare.com");

    const { inviteCommand } = host.start();
    const invite = inviteCommand("frontend", tunnelUrl!);
    expect(invite).toContain("wss://alpha-custom.trycloudflare.com");
    expect(invite).toContain("--lane frontend");

    host.stop();
  });

  it("DIALECTIC PRESET: initializes topic.md, axioms.md, and turns with turn-taking blocking", async () => {
    const dialecticWs = `${BASE_TEST_DIR}/dialectic_workspace`;
    fs.mkdirSync(dialecticWs, { recursive: true });

    const host = new InitRunner({
      port: 9029,
      roomId: "dialectic-room",
      workspaceRoot: dialecticWs,
      preset: "dialectic",
      topic: "Is human consciousness algorithmic?"
    });

    const { inviteCommand, preset } = host.start();
    expect(preset.id).toBe("dialectic");
    expect(preset.bannerTitle).toContain("DIALECTIC");

    // Verify CONTRACT files initialized
    expect(fs.existsSync(`${dialecticWs}/CONTRACT/topic.md`)).toBe(true);
    expect(fs.existsSync(`${dialecticWs}/CONTRACT/axioms.md`)).toBe(true);
    expect(fs.existsSync(`${dialecticWs}/CONTRACT/peers.template.md`)).toBe(true);

    const topicContent = fs.readFileSync(`${dialecticWs}/CONTRACT/topic.md`, "utf8");
    expect(topicContent).toContain("Is human consciousness algorithmic?");
    expect(topicContent).toContain("Natural Conversational Prose (No Sterile Headings)");

    // Verify initial round pair generated with turn-taking blocking
    const tasksRaw = fs.readFileSync(`${dialecticWs}/.nucleus/tasks.json`, "utf8");
    const tasks = JSON.parse(tasksRaw);
    expect(tasks.length).toBe(2);

    const round1Pro = tasks.find((t: any) => t.id === "round-01-pro");
    const round1Contra = tasks.find((t: any) => t.id === "round-01-contra");
    expect(round1Pro.status).toBe("unassigned");
    expect(round1Contra.status).toBe("blocked");

    // Contra cannot claim round 1 contra while blocked
    const contraClaimBlocked = claimTaskLocally(dialecticWs, "round-01-contra", "ContraAgent", "contra");
    expect(contraClaimBlocked).toBe(false);

    // Pro claims and completes round 1
    const proClaimOk = claimTaskLocally(dialecticWs, "round-01-pro", "ProAgent", "pro");
    expect(proClaimOk).toBe(true);

    // Coordinator unblocks dependent tasks when round 1 pro is approved
    const server = host["coordinator"];
    expect(server).toBeDefined();
    server!.getTaskBoard().updateStatus("round-01-pro", "approved");

    const updatedContra = server!.getTaskBoard().getTask("round-01-contra");
    expect(updatedContra?.status).toBe("unassigned");

    // Now Contra can claim round 1 contra!
    fs.writeFileSync(`${dialecticWs}/.nucleus/tasks.json`, JSON.stringify(server!.getTaskBoard().getAll(), null, 2), "utf8");
    const contraClaimOk = claimTaskLocally(dialecticWs, "round-01-contra", "ContraAgent", "contra");
    expect(contraClaimOk).toBe(true);

    // When round 1 contra is approved, Round 2 automatically and dynamically spawns!
    const contraApprovalResult = server!.getTaskBoard().updateStatus("round-01-contra", "approved");
    expect(contraApprovalResult.spawnedTasks).toBeDefined();
    expect(contraApprovalResult.spawnedTasks!.length).toBe(2);

    const round2Pro = server!.getTaskBoard().getTask("round-02-pro");
    const round2Contra = server!.getTaskBoard().getTask("round-02-contra");
    expect(round2Pro).toBeDefined();
    expect(round2Pro?.status).toBe("unassigned");
    expect(round2Contra).toBeDefined();
    expect(round2Contra?.status).toBe("blocked");

    const invitePro = inviteCommand("pro");
    expect(invitePro).toContain("--lane pro");
    const inviteContra = inviteCommand("contra");
    expect(inviteContra).toContain("--lane contra");

    host.stop();
  });

  it("BRAINSTORM PRESET: initializes PRD.md, decisions.md, and 4 functional roles", async () => {
    const brainstormWs = `${BASE_TEST_DIR}/brainstorm_workspace`;
    fs.mkdirSync(brainstormWs, { recursive: true });

    const host = new InitRunner({
      port: 9031,
      roomId: "brainstorm-room",
      workspaceRoot: brainstormWs,
      preset: "brainstorm",
      topic: "Autonomous AI Dev Environments"
    });

    const { preset } = host.start();
    expect(preset.id).toBe("brainstorm");

    expect(fs.existsSync(`${brainstormWs}/CONTRACT/PRD.md`)).toBe(true);
    expect(fs.existsSync(`${brainstormWs}/CONTRACT/decisions.md`)).toBe(true);

    const tasksRaw = fs.readFileSync(`${brainstormWs}/.nucleus/tasks.json`, "utf8");
    const tasks = JSON.parse(tasksRaw);
    expect(tasks.length).toBe(4);
    const lanes = tasks.map((t: any) => t.lane);
    expect(lanes).toContain("vision");
    expect(lanes).toContain("skeptic");
    expect(lanes).toContain("market");
    expect(lanes).toContain("systems");

    host.stop();
  });
});
