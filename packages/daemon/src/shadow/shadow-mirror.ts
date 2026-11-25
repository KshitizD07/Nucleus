import fs from "node:fs";
import path from "node:path";
import { WorkspaceJail } from "../jail/jail.js";
import type { LaneShadowSync } from "@nucleus/protocol";

export class ShadowMirror {
  private readonly jail: WorkspaceJail;
  private readonly shadowsBaseDir: string;
  private readonly manifestPath: string;
  private readonly fileVersions: Map<string, number> = new Map();

  constructor(workspaceRoot: string) {
    this.jail = new WorkspaceJail(workspaceRoot);
    this.shadowsBaseDir = this.jail.resolveSafe(path.join(".nucleus", "shadows"));
    fs.mkdirSync(this.shadowsBaseDir, { recursive: true });
    this.manifestPath = this.jail.resolveSafe(path.join(".nucleus", "shadows-manifest.json"));
    this.loadManifest();
  }

  private loadManifest(): void {
    if (!fs.existsSync(this.manifestPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.manifestPath, "utf8"));
      if (typeof data === "object" && data !== null) {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "number") {
            this.fileVersions.set(k, v);
          }
        }
      }
    } catch {}
  }

  private saveManifest(): void {
    const data: Record<string, number> = {};
    for (const [k, v] of this.fileVersions.entries()) {
      data[k] = v;
    }
    const dir = path.dirname(this.manifestPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.shadows-manifest.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
    );
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmp, this.manifestPath);
    } catch {}
  }

  /**
   * Apply an incoming shadow file sync into `.nucleus/shadows/<lane>/<file_path>`
   */
  public applySync(sync: LaneShadowSync): { applied: boolean; reason?: string } {
    const key = `${sync.source_lane}:${sync.file_path}`;
    const currentVersion = this.fileVersions.get(key) ?? 0;

    if (sync.version <= currentVersion) {
      return {
        applied: false,
        reason: `Ignored stale shadow sync v${sync.version} (current: v${currentVersion})`
      };
    }

    // Ensure path resolves safely under .nucleus/shadows/<source_lane>
    const relativeTarget = path.join(".nucleus", "shadows", sync.source_lane, sync.file_path);
    const safeTarget = this.jail.resolveSafe(relativeTarget);

    fs.mkdirSync(path.dirname(safeTarget), { recursive: true });
    fs.writeFileSync(safeTarget, sync.content, "utf8");
    this.fileVersions.set(key, sync.version);
    this.saveManifest();

    return { applied: true };
  }

  public readShadowFile(sourceLane: string, filePath: string): string | null {
    const relativeTarget = path.join(".nucleus", "shadows", sourceLane, filePath);
    const safeTarget = this.jail.resolveSafe(relativeTarget);

    if (!fs.existsSync(safeTarget)) {
      return null;
    }
    return fs.readFileSync(safeTarget, "utf8");
  }

  /**
   * Delete a shadow file from `.nucleus/shadows/<lane>/<file_path>` when a peer deletes it
   */
  public deleteShadowFile(sourceLane: string, filePath: string, version?: number): boolean {
    const key = `${sourceLane}:${filePath}`;
    const currentVersion = this.fileVersions.get(key) ?? 0;

    if (version !== undefined && version <= currentVersion) {
      return false;
    }

    const relativeTarget = path.join(".nucleus", "shadows", sourceLane, filePath);
    const safeTarget = this.jail.resolveSafe(relativeTarget);

    if (fs.existsSync(safeTarget)) {
      try {
        fs.unlinkSync(safeTarget);
        let dir = path.dirname(safeTarget);
        const laneDir = path.join(this.shadowsBaseDir, sourceLane);
        while (dir.startsWith(laneDir) && dir !== laneDir) {
          if (fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
            dir = path.dirname(dir);
          } else {
            break;
          }
        }
      } catch {
        // Ignore file system race or deletion errors
      }
    }

    if (version !== undefined) {
      this.fileVersions.set(key, version);
    } else {
      this.fileVersions.delete(key);
    }
    this.saveManifest();

    return true;
  }

  public clearLane(sourceLane: string): void {
    const laneDir = path.join(this.shadowsBaseDir, sourceLane);
    if (fs.existsSync(laneDir)) {
      fs.rmSync(laneDir, { recursive: true, force: true });
    }
    for (const key of this.fileVersions.keys()) {
      if (key.startsWith(`${sourceLane}:`)) {
        this.fileVersions.delete(key);
      }
    }
    this.saveManifest();
  }
}
