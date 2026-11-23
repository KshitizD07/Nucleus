import fs from "node:fs";
import path from "node:path";
import { WorkspaceJail } from "../jail/jail.js";

export interface ContractWatcherOptions {
  workspaceRoot: string;
  contractSubdir?: string; // default "CONTRACT"
  debounceMs?: number;
  onContractChange: (filePath: string, content: string) => void;
}

export class ContractWatcher {
  private readonly jail: WorkspaceJail;
  private readonly contractDir: string;
  private readonly debounceMs: number;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private onContractChange: (filePath: string, content: string) => void;

  constructor(options: ContractWatcherOptions) {
    this.jail = new WorkspaceJail(options.workspaceRoot);
    const subdir = options.contractSubdir ?? "CONTRACT";
    this.contractDir = this.jail.resolveSafe(subdir);
    this.debounceMs = options.debounceMs ?? 300;
    this.onContractChange = options.onContractChange;
    fs.mkdirSync(this.contractDir, { recursive: true });
  }

  public start(): void {
    if (this.watcher) return;
    this.watcher = fs.watch(this.contractDir, { recursive: false }, (eventType, filename) => {
      if (!filename) return;

      const timer = this.debounceTimers.get(filename);
      if (timer) clearTimeout(timer);

      this.debounceTimers.set(
        filename,
        setTimeout(() => {
          this.debounceTimers.delete(filename);
          this.handleFileChange(filename);
        }, this.debounceMs)
      );
    });
  }

  public stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private handleFileChange(filename: string): void {
    try {
      const fullPath = this.jail.resolveSafe(path.join("CONTRACT", filename));
      if (!fs.existsSync(fullPath)) return;
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return;

      const content = fs.readFileSync(fullPath, "utf8");
      this.onContractChange(filename, content);
    } catch {
      // Ignore transient file lock / deletion errors during rapid editing
    }
  }
}
