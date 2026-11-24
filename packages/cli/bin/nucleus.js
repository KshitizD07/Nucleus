#!/usr/bin/env node
import {
  parseCli,
  printHelp,
  InitRunner,
  JoinRunner,
  listTasks,
  claimTaskLocally,
  releaseTaskLocally,
  archiveCompletedTasksLocally
} from "../dist/index.js";

const cli = parseCli(process.argv.slice(2));

if (cli.command === "help" || cli.help) {
  printHelp();
  process.exit(0);
}

if (cli.command === "tasks") {
  if (cli.clean) {
    archiveCompletedTasksLocally(cli.workspace || process.cwd());
  } else {
    listTasks(cli.workspace || process.cwd(), cli.lane, undefined, cli.archived);
  }
  process.exit(0);
} else if (cli.command === "claim") {
  if (!cli.taskId) {
    console.error("Error: Task ID required. Example: nucleus claim task-auth-01");
    process.exit(1);
  }
  const assignee = cli.name || process.env.USER || process.env.USERNAME || "contributor";
  const ok = claimTaskLocally(cli.workspace || process.cwd(), cli.taskId, assignee, cli.lane);
  process.exit(ok ? 0 : 1);
} else if (cli.command === "release" || cli.command === "unclaim") {
  if (!cli.taskId) {
    console.error("Error: Task ID required. Example: nucleus release task-auth-01");
    process.exit(1);
  }
  const assignee = cli.name || process.env.USER || process.env.USERNAME || "contributor";
  const ok = releaseTaskLocally(cli.workspace || process.cwd(), cli.taskId, assignee);
  process.exit(ok ? 0 : 1);
} else if (cli.command === "init") {
  const runner = new InitRunner({
    port: cli.port,
    roomId: cli.roomId,
    workspaceRoot: cli.workspace,
    tunnel: cli.tunnel
  });

  const { inviteCommand, tunnelGuidance, localIp } = runner.start();

  console.log("Sample invite commands for teammates:\n");
  if (localIp && localIp !== "localhost") {
    console.log(`  📡 Friend on Same Wi-Fi / Local Network (${localIp}):`);
    console.log(`    Frontend :  ${inviteCommand("frontend")}`);
    console.log(`    Backend  :  ${inviteCommand("backend")}`);
    console.log(`    QA / DB  :  ${inviteCommand("qa")}\n`);
  }

  console.log(`  💻 Same Machine (Localhost):`);
  console.log(`    Frontend :  ${inviteCommand("frontend", `ws://localhost:${cli.port || 9876}`)}`);
  console.log(`    Backend  :  ${inviteCommand("backend", `ws://localhost:${cli.port || 9876}`)}\n`);

  if (cli.tunnel) {
    console.log("🚇 Initializing zero-config public tunnel...");
    runner.startTunnel().then((tunnelUrl) => {
      if (tunnelUrl) {
        console.log(`  🌍 Public Internet Tunnel (${tunnelUrl}):`);
        console.log(`    Frontend :  ${inviteCommand("frontend", tunnelUrl)}`);
        console.log(`    Backend  :  ${inviteCommand("backend", tunnelUrl)}`);
        console.log(`    QA / DB  :  ${inviteCommand("qa", tunnelUrl)}\n`);
      } else {
        console.log(`⚠️ Tunnel could not be established. Ensure cloudflared or ngrok is installed in your PATH.\n`);
      }
    });
  } else if (tunnelGuidance) {
    console.log(tunnelGuidance + "\n");
  }
  console.log("Press Ctrl+C to close room.\n");

  process.on("SIGINT", () => {
    runner.stop();
    process.exit(0);
  });
} else if (cli.command === "join") {
  if (!cli.url || !cli.token || !cli.lane) {
    console.error("Error: --url, --token, and --lane are required to join a room.");
    console.error("Usage: nucleus join --url ws://host:9876 --token <tok> --lane <lane>");
    process.exit(1);
  }

  const joiner = new JoinRunner({
    url: cli.url,
    token: cli.token,
    lane: cli.lane,
    workspaceRoot: cli.workspace
  });

  joiner.start().then(() => {
    console.log("Ready. Operating under the Pure Pull Model.");
    console.log("Run your own CLI (Claude Code, Antigravity, Aider) in this workspace.");
    console.log("Press Ctrl+C to disconnect from room.\n");
  }).catch((err) => {
    console.error("Failed to connect to room:", err.message);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    joiner.stop();
    process.exit(0);
  });
} else {
  printHelp();
  process.exit(0);
}
