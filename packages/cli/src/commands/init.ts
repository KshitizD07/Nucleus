import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CoordinatorServer } from "@nucleus/coordinator";
import { TunnelManager } from "../tunnel/tunnel-manager.js";
import { getPreset, type RoomPreset } from "../presets/index.js";

export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

export interface InitRunnerOptions {
  port?: number;
  roomId?: string;
  workspaceRoot?: string;
  tunnel?: boolean;
  tunnelUrl?: string;
  preset?: string;
  topic?: string;
}

export class InitRunner {
  private coordinator: CoordinatorServer | null = null;
  private tunnelManager: TunnelManager | null = null;
  private tunnelUrl: string | null = null;
  private readonly port: number;
  private readonly roomId: string;
  private readonly workspaceRoot: string;
  private readonly options: InitRunnerOptions;

  constructor(options: InitRunnerOptions = {}) {
    this.options = options;
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    this.port = options.port || 9876;
    this.roomId = options.roomId || path.basename(this.workspaceRoot);
    if (options.tunnelUrl) {
      this.tunnelUrl = options.tunnelUrl;
    }
  }

  public start(): {
    coordinator: CoordinatorServer;
    inviteCommand: (lane: string, hostUrl?: string) => string;
    tunnelGuidance: string;
    localIp: string;
    tunnelUrl?: string;
    preset: RoomPreset;
  } {
    const nucleusDir = path.join(this.workspaceRoot, ".nucleus");
    const contractDir = path.join(this.workspaceRoot, "CONTRACT");
    const logsDir = path.join(nucleusDir, "logs");

    fs.mkdirSync(nucleusDir, { recursive: true });
    fs.mkdirSync(contractDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    const preset = getPreset(this.options.preset);

    // Initialize preset living contracts in CONTRACT/
    for (const contract of preset.contracts) {
      const contractPath = path.join(contractDir, contract.relativePath);
      if (!fs.existsSync(contractPath)) {
        let content = contract.initialContent;
        if (this.options.topic && content.includes("(Topic under investigation)")) {
          content = content.replace("(Topic under investigation)", this.options.topic);
        }
        fs.writeFileSync(contractPath, content, "utf8");
      }
    }

    // Initialize custom agent collaboration rules in CONTRACT/peers.template.md if provided
    if (preset.peersTemplate) {
      const templatePath = path.join(contractDir, "peers.template.md");
      if (!fs.existsSync(templatePath)) {
        fs.writeFileSync(templatePath, preset.peersTemplate.trim(), "utf8");
      }
    }

    // Ensure tasks backlog exists if .nucleus/tasks.json is empty
    const tasksFile = path.join(nucleusDir, "tasks.json");
    if (!fs.existsSync(tasksFile)) {
      const tasks = preset.initialTasks(this.options.topic);
      fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), "utf8");
    }

    this.coordinator = new CoordinatorServer({
      port: this.port,
      roomId: this.roomId,
      logDir: logsDir,
      contractDir,
      taskDir: nucleusDir
    });

    this.coordinator.start();

    console.log(`\n======================================================`);
    console.log(`${preset.bannerTitle}: [${this.roomId}]`);
    if (this.options.topic) {
      console.log(`Topic: "${this.options.topic}"`);
    }
    console.log(`Listening on ws://localhost:${this.port}`);
    console.log(`Bound to workspace: ${this.workspaceRoot}`);
    console.log(`Preset: ${preset.name}`);
    console.log(`======================================================\n`);

    const localIp = getLocalIp();

    const inviteCommand = (lane: string, hostUrl?: string): string => {
      if (!this.coordinator) throw new Error("Coordinator not running");
      const url = hostUrl || (localIp !== "localhost" ? `ws://${localIp}:${this.port}` : `ws://localhost:${this.port}`);
      const token = this.coordinator.issueInvite(lane);
      return `nucleus join --url ${url} --token ${token} --lane ${lane}`;
    };

    const tunnelGuidance = [
      "🌐 Over the Internet / Remote (No Port Forwarding Required):",
      `   1. Cloudflare Tunnel : cloudflared tunnel --url ws://localhost:${this.port}`,
      `   2. Tailscale VPN     : nucleus join --url ws://<your-tailscale-ip>:${this.port} ...`,
      `   3. Ngrok             : ngrok http ${this.port}`
    ].join("\n");

    return {
      coordinator: this.coordinator,
      inviteCommand,
      tunnelGuidance,
      localIp,
      tunnelUrl: this.tunnelUrl ?? undefined,
      preset
    };
  }

  public async startTunnel(): Promise<string | null> {
    if (!this.tunnelManager) {
      this.tunnelManager = new TunnelManager();
    }
    const result = await this.tunnelManager.start(this.port, this.options.tunnelUrl);
    if (result) {
      this.tunnelUrl = result.url;
      return result.url;
    }
    return null;
  }

  public stop(): void {
    if (this.tunnelManager) {
      this.tunnelManager.stop();
      this.tunnelManager = null;
    }
    if (this.coordinator) {
      this.coordinator.stop();
      this.coordinator = null;
      console.log(`[Coordinator] Room closed.`);
    }
  }
}
