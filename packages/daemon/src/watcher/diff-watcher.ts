import fs from "node:fs";
import path from "node:path";
import { WorkspaceJail } from "../jail/jail.js";
import type { LiveDiffStream } from "@nucleus/protocol";

export interface WorkspaceDiffWatcherOptions {
  workspaceRoot: string;
  lane: string;
  ignoredPatterns?: string[];
  debounceMs?: number;
  onDiffStream: (diff: LiveDiffStream) => void;
  onFocusChange: (filePath: string, action: "editing" | "idle" | "saved") => void;
}

export class WorkspaceDiffWatcher {
  private readonly jail: WorkspaceJail;
  private readonly workspaceRoot: string;
  private readonly lane: string;
  private readonly ignoredPatterns: string[];
  private readonly debounceMs: number;
  private readonly onDiffStream: (diff: LiveDiffStream) => void;
  private readonly onFocusChange: (filePath: string, action: "editing" | "idle" | "saved") => void;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private fileSnapshots: Map<string, string> = new Map();

  constructor(options: WorkspaceDiffWatcherOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.jail = new WorkspaceJail(this.workspaceRoot);
    this.lane = options.lane;
    this.ignoredPatterns = options.ignoredPatterns ?? [
      "node_modules",
      ".git",
      ".nucleus",
      "dist",
      "build",
      ".cache"
    ];
    this.debounceMs = options.debounceMs ?? 300;
    this.onDiffStream = options.onDiffStream;
    this.onFocusChange = options.onFocusChange;
  }

  public start(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.workspaceRoot, { recursive: true }, (eventType, relativeFilename) => {
        if (!relativeFilename) return;
        const normalized = relativeFilename.replace(/\\/g, "/");

        // Ignore excluded folders
        if (this.isIgnored(normalized)) return;

        this.onFocusChange(normalized, "editing");

        const timer = this.debounceTimers.get(normalized);
        if (timer) clearTimeout(timer);

        this.debounceTimers.set(
          normalized,
          setTimeout(() => {
            this.debounceTimers.delete(normalized);
            this.handleFileChange(normalized);
          }, this.debounceMs)
        );
      });
    } catch (err) {
      console.warn(`[WorkspaceDiffWatcher] Failed to attach fs.watch:`, err);
    }
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

  private isIgnored(filePath: string): boolean {
    return this.ignoredPatterns.some((pattern) => filePath.startsWith(pattern) || filePath.includes(`/${pattern}/`));
  }

  private handleFileChange(relativeFilePath: string): void {
    try {
      const fullPath = this.jail.resolveSafe(relativeFilePath);
      if (!fs.existsSync(fullPath)) return;
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return;

      const newContent = fs.readFileSync(fullPath, "utf8");
      const oldContent = this.fileSnapshots.get(relativeFilePath) ?? "";
      this.fileSnapshots.set(relativeFilePath, newContent);

      this.onFocusChange(relativeFilePath, "saved");

      // Calculate simple line diff summary
      const oldLines = oldContent ? oldContent.split("\n").length : 0;
      const newLines = newContent.split("\n").length;
      const delta = newLines - oldLines;
      const patchSummary = `${delta >= 0 ? `+${delta}` : delta} lines in ${path.basename(relativeFilePath)}`;

      const diffStream: LiveDiffStream = {
        lane: this.lane,
        active_file: relativeFilePath,
        files_changed: [relativeFilePath],
        patch_summary: patchSummary,
        diff_hunk: newContent.length < 50_000 ? newContent : "(diff truncated, file exceeds 50KB)"
      };

      this.onDiffStream(diffStream);
    } catch {
      // Ignore transient file lock / deletion errors during active build
    }
  }
}
