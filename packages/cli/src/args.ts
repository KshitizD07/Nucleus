import { parseArgs } from "node:util";

export interface ParsedCliArgs {
  command: "init" | "join" | "invite" | "status" | "help" | "unknown";
  port?: number;
  roomId?: string;
  url?: string;
  token?: string;
  lane?: string;
  workspace?: string;
  help?: boolean;
}

export function parseCli(args: string[]): ParsedCliArgs {
  const options = {
    port: { type: "string" as const, short: "p" },
    room: { type: "string" as const, short: "r" },
    url: { type: "string" as const, short: "u" },
    token: { type: "string" as const, short: "t" },
    lane: { type: "string" as const, short: "l" },
    workspace: { type: "string" as const, short: "w" },
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

    if (["init", "join", "invite", "status", "help"].includes(primaryCommand)) {
      cmd = primaryCommand as ParsedCliArgs["command"];
    }

    if (values.help) {
      cmd = "help";
    }

    return {
      command: cmd,
      port: values.port ? parseInt(values.port, 10) : undefined,
      roomId: values.room,
      url: values.url,
      token: values.token,
      lane: values.lane,
      workspace: values.workspace,
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
  init      Open and host a multiplayer room for the current project
  join      Connect this workspace to an existing multiplayer room
  invite    Issue a join invite token for a specific lane (when hosting)
  status    Show active room status and peer activity
  help      Display help information

Options:
  -p, --port <number>       Coordinator WebSocket port (default: 9876)
  -r, --room <string>       Room identifier (default: current directory name)
  -u, --url <string>        Coordinator WebSocket URL for joining (e.g. ws://host:9876)
  -t, --token <string>      Single-use invite token (required for join)
  -l, --lane <string>       Assigned development lane (e.g. backend, frontend, qa)
  -w, --workspace <path>    Project root path (default: current working directory)
  -h, --help                Show this help message
`);
}
