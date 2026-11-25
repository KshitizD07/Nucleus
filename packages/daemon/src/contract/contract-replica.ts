import fs from "node:fs";
import path from "node:path";
import { WorkspaceJail } from "../jail/jail.js";
import type { ContractUpdateBroadcast } from "@nucleus/protocol";

export interface ContractReplicaOptions {
  workspaceRoot: string;
  contractSubdir?: string; // default "CONTRACT"
}

export class ContractReplica {
  private readonly jail: WorkspaceJail;
  private readonly contractDir: string;
  private readonly manifestPath: string;
  private readonly versions: Map<string, number> = new Map();

  constructor(options: ContractReplicaOptions) {
    this.jail = new WorkspaceJail(options.workspaceRoot);
    const subdir = options.contractSubdir ?? "CONTRACT";
    this.contractDir = this.jail.resolveSafe(subdir);
    fs.mkdirSync(this.contractDir, { recursive: true });
    this.manifestPath = this.jail.resolveSafe(path.join(".nucleus", "contracts-manifest.json"));
    this.loadManifest();
  }

  private loadManifest(): void {
    if (!fs.existsSync(this.manifestPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.manifestPath, "utf8"));
      if (typeof data === "object" && data !== null) {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "number") {
            this.versions.set(k, v);
          }
        }
      }
    } catch {}
  }

  private saveManifest(): void {
    const data: Record<string, number> = {};
    for (const [k, v] of this.versions.entries()) {
      data[k] = v;
    }
    const dir = path.dirname(this.manifestPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.contracts-manifest.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
    );
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmp, this.manifestPath);
    } catch {}
  }

  /**
   * Apply an incoming contract broadcast from the room coordinator.
   * Validates version progression and writes the file safely within the jail.
   */
  public applyUpdate(broadcast: ContractUpdateBroadcast): { applied: boolean; reason?: string } {
    const currentVer = this.versions.get(broadcast.file_path) ?? 0;
    if (broadcast.version <= currentVer) {
      return {
        applied: false,
        reason: `Ignored stale or duplicate contract version ${broadcast.version} (current: ${currentVer})`
      };
    }

    const safeTarget = this.jail.resolveSafe(path.join("CONTRACT", broadcast.file_path));
    fs.mkdirSync(path.dirname(safeTarget), { recursive: true });
    fs.writeFileSync(safeTarget, broadcast.content, "utf8");
    this.versions.set(broadcast.file_path, broadcast.version);
    this.saveManifest();

    return { applied: true };
  }

  public getVersion(filePath: string): number {
    return this.versions.get(filePath) ?? 0;
  }

  public readFile(filePath: string): string | null {
    const safeTarget = this.jail.resolveSafe(path.join("CONTRACT", filePath));
    if (!fs.existsSync(safeTarget)) {
      return null;
    }
    return fs.readFileSync(safeTarget, "utf8");
  }
}
