import fs from "node:fs";
import path from "node:path";
import { CoordinatorServer } from "@nucleus/coordinator";

export interface InitRunnerOptions {
  port?: number;
  roomId?: string;
  workspaceRoot?: string;
}

export class InitRunner {
  private coordinator: CoordinatorServer | null = null;
  private readonly port: number;
  private readonly roomId: string;
  private readonly workspaceRoot: string;

  constructor(options: InitRunnerOptions = {}) {
    this.workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    this.port = options.port || 9876;
    this.roomId = options.roomId || path.basename(this.workspaceRoot);
  }

  public start(): {
    coordinator: CoordinatorServer;
    inviteCommand: (lane: string, hostUrl?: string) => string;
    tunnelGuidance: string;
  } {
    const nucleusDir = path.join(this.workspaceRoot, ".nucleus");
    const contractDir = path.join(this.workspaceRoot, "CONTRACT");
    const logsDir = path.join(nucleusDir, "logs");

    fs.mkdirSync(nucleusDir, { recursive: true });
    fs.mkdirSync(contractDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Ensure sample contract template exists if CONTRACT is empty
    const apiContract = path.join(contractDir, "api.md");
    if (!fs.existsSync(apiContract)) {
      fs.writeFileSync(
        apiContract,
        "# Project Living Contract: API Specifications\n\nFrozen endpoints and envelopes.\n",
        "utf8"
      );
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
    console.log(`⚛️  NUCLEUS ROOM HOSTED: [${this.roomId}]`);
    console.log(`Listening on ws://localhost:${this.port}`);
    console.log(`Bound to workspace: ${this.workspaceRoot}`);
    console.log(`======================================================\n`);

    const inviteCommand = (lane: string, hostUrl = `ws://localhost:${this.port}`): string => {
      if (!this.coordinator) throw new Error("Coordinator not running");
      const token = this.coordinator.issueInvite(lane);
      return `nucleus join --url ${hostUrl} --token ${token} --lane ${lane}`;
    };

    const tunnelGuidance = [
      "🌐 WAN / Internet Access Options (No Port Forwarding Required):",
      `   1. Cloudflare Tunnel : cloudflared tunnel --url ws://localhost:${this.port}`,
      `   2. Tailscale VPN     : nucleus join --url ws://<tailscale-ip>:${this.port} ...`,
      `   3. Ngrok             : ngrok http ${this.port}`
    ].join("\n");

    return {
      coordinator: this.coordinator,
      inviteCommand,
      tunnelGuidance
    };
  }

  public stop(): void {
    if (this.coordinator) {
      this.coordinator.stop();
      this.coordinator = null;
      console.log(`[Coordinator] Room closed.`);
    }
  }
}
