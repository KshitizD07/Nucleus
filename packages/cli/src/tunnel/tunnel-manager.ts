import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";

export interface TunnelResult {
  url: string;
  provider: "cloudflared" | "ngrok" | "custom";
}

export class TunnelManager {
  private tunnelProcess: ChildProcess | null = null;

  public async start(port: number, customUrl?: string): Promise<TunnelResult | null> {
    if (customUrl) {
      return { url: customUrl, provider: "custom" };
    }

    // Attempt cloudflared first
    const cf = await this.tryCloudflared(port);
    if (cf) return cf;

    // Fall back to ngrok
    const ng = await this.tryNgrok(port);
    if (ng) return ng;

    return null;
  }

  public stop(): void {
    if (this.tunnelProcess) {
      try {
        this.tunnelProcess.kill();
      } catch {
        // Process may already have exited
      }
      this.tunnelProcess = null;
    }
  }

  public getTunnelProcess(): ChildProcess | null {
    return this.tunnelProcess;
  }

  private resolveCloudflaredBinary(): string {
    const candidates = [
      "cloudflared",
      "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      "C:\\Program Files\\cloudflared\\cloudflared.exe",
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages\\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\\cloudflared.exe` : ""
    ].filter(Boolean);

    for (const cand of candidates) {
      if (cand === "cloudflared") return cand;
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return "cloudflared";
  }

  private tryCloudflared(port: number): Promise<TunnelResult | null> {
    return new Promise((resolve) => {
      let resolved = false;
      let proc: ChildProcess;
      const bin = this.resolveCloudflaredBinary();

      try {
        proc = spawn(bin, ["tunnel", "--url", `http://localhost:${port}`], {
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch {
        return resolve(null);
      }

      proc.on("error", () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });

      const onData = (data: Buffer) => {
        const str = data.toString();
        const match = str.match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
        if (match && !resolved) {
          resolved = true;
          this.tunnelProcess = proc;
          resolve({
            url: `wss://${match[1]}`,
            provider: "cloudflared"
          });
        }
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            proc.kill();
          } catch {}
          resolve(null);
        }
      }, 15000);
    });
  }

  private tryNgrok(port: number): Promise<TunnelResult | null> {
    return new Promise((resolve) => {
      let resolved = false;
      let proc: ChildProcess;

      try {
        proc = spawn("ngrok", ["http", port.toString()], {
          stdio: "ignore"
        });
      } catch {
        return resolve(null);
      }

      proc.on("error", () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });

      const interval = setInterval(async () => {
        try {
          const res = await fetch("http://127.0.0.1:4040/api/tunnels");
          if (res.ok) {
            const data: any = await res.json();
            const publicUrl = data.tunnels?.[0]?.public_url;
            if (publicUrl && !resolved) {
              resolved = true;
              clearInterval(interval);
              this.tunnelProcess = proc;
              const wssUrl = publicUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
              resolve({ url: wssUrl, provider: "ngrok" });
            }
          }
        } catch {
          // Tunnel inspect endpoint not ready yet
        }
      }, 500);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(interval);
          try {
            proc.kill();
          } catch {}
          resolve(null);
        }
      }, 4000);
    });
  }
}
