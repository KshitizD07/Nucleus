import { parseArgs } from "node:util";

export interface ParsedCliArgs {
  command: "init" | "join" | "invite" | "status" | "tasks" | "claim" | "release" | "unclaim" | "help" | "unknown";
  taskId?: string;
  name?: string;
  port?: number;
  roomId?: string;
  url?: string;
  token?: string;
  lane?: string;
  workspace?: string;
  tunnel?: boolean;
  clean?: boolean;
  archived?: boolean;
  preset?: string;
  topic?: string;
  help?: boolean;
}

export function parseCli(args: string[]): ParsedCliArgs {
  const options = {
    port: { type: "string" as const, short: "p" },
    room: { type: "string" as const, short: "r" },
    url: { type: "string" as const, short: "u" },
    token: { type: "string" as const, short: "t" },
    lane: { type: "string" as const, short: "l" },
    name: { type: "string" as const, short: "n" },
    workspace: { type: "string" as const, short: "w" },
    tunnel: { type: "boolean" as const },
    clean: { type: "boolean" as const, short: "c" },
    archived: { type: "boolean" as const, short: "a" },
    preset: { type: "string" as const, short: "P" },
    topic: { type: "string" as const },
    help: { type: "boolean" as const, short: "h" }
  };

  try {
    const { values, positionals } = parseArgs({
      args,
      options,
      allowPositionals: true
    });

    const primaryCommand = positionals[0] || "help";
    let cmd: ParsedCliArgs["command"] = "unknown";

    if (["init", "join", "invite", "status", "tasks", "claim", "release", "unclaim", "help"].includes(primaryCommand)) {
      cmd = primaryCommand as ParsedCliArgs["command"];
    }

    if (values.help) {
      cmd = "help";
    }

    return {
      command: cmd,
      taskId: positionals[1],
      name: values.name,
      port: values.port ? parseInt(values.port, 10) : undefined,
      roomId: values.room,
      url: values.url,
      token: values.token,
      lane: values.lane,
      workspace: values.workspace,
      tunnel: values.tunnel,
      clean: values.clean,
      archived: values.archived,
      preset: values.preset,
      topic: values.topic,
      help: values.help
    };
  } catch (err: any) {
    return {
      command: "unknown",
      help: true
    };
  }
}

export function printHelp(): void {
  console.log(`
Nucleus — Multiplayer AI Engineering Room CLI

Usage:
  nucleus <command> [options]

Commands:
  init             Open and host a multiplayer room for the current project
  join             Connect this workspace to an existing multiplayer room
  tasks            View and filter the shared task board (.nucleus/tasks.json)
  claim <task_id>  Claim an available task on the board for yourself
  release <id>     Release/unclaim a claimed task back to unassigned
  invite           Issue a join invite token for a specific lane (when hosting)
  status           Show active room status and peer activity
  help             Display help information

Options:
  -p, --port <number>       Coordinator WebSocket port (default: 9876)
  -r, --room <string>       Room identifier (default: current directory name)
  -u, --url <string>        Coordinator WebSocket URL for joining (e.g. ws://host:9876)
  -t, --token <string>      Single-use invite token (required for join)
  -l, --lane <string>       Assigned development lane (e.g. backend, frontend, qa)
  -n, --name <string>       Your name / handle in the room
  -w, --workspace <path>    Project root path (default: current working directory)
      --tunnel              Start zero-config Cloudflare/ngrok tunnel for public internet invites
  -P, --preset <name>       Room preset: engineering (default), dialectic, brainstorm
      --topic <string>      Resolution topic for debate/brainstorm room
  -c, --clean               Archive completed/approved tasks into .nucleus/tasks_archive.json
  -a, --archived            View completed/archived tasks from .nucleus/tasks_archive.json
  -h, --help                Show this help message
`);
}
