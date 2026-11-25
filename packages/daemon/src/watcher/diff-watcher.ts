import fs from "node:fs";
import path from "node:path";
import { WorkspaceJail } from "../jail/jail.js";
import type { LiveDiffStream } from "@nucleus/protocol";
import { createUnifiedDiff } from "./diff-generator.js";

export const GLOBAL_NON_BYPASSABLE_IGNORES: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nucleus/shadows",
  ".cache",
  ".turbo",
  "coverage",
  "out"
];

export const SENSITIVE_FILENAME_PATTERNS: readonly RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /^credentials.*\.json$/i,
  /^service-account.*\.json$/i
];

export const SENSITIVE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".pem", ".key", ".pfx", ".p12", ".pkcs12", ".crt", ".cer", ".der"
]);

export const OUTBOUND_SECRET_PATTERNS: readonly { name: string; regex: RegExp }[] = [
  {
    name: "Private Key Header",
    regex: /-----BEGIN (RSA|EC|DSA|OPENSSH)?\s?PRIVATE KEY-----/i
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    name: "Stripe Secret Key",
    regex: /\b(sk_live_[0-9a-zA-Z]{24,})\b/
  },
  {
    name: "Generic Secret / Token Assignment",
    regex: /(api_key|apikey|secret|password|passwd|private_key)\s*[:=]\s*["'][a-zA-Z0-9_\-.~!@#$%^&*+=]{8,}["']/i
  }
];

export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".mov", ".avi", ".wav",
  ".pyc", ".class", ".wasm", ".db", ".sqlite", ".iso"
]);

export interface WorkspaceDiffWatcherOptions {
  workspaceRoot: string;
  lane: string;
  ignoredPatterns?: string[];
  debounceMs?: number;
  onDiffStream: (diff: LiveDiffStream) => void;
  onFocusChange: (filePath: string, action: "editing" | "idle" | "saved") => void;
  onShadowSync?: (filePath: string, content: string) => void;
  onShadowDelete?: (filePath: string) => void;
}

export class WorkspaceDiffWatcher {
  private readonly jail: WorkspaceJail;
  private readonly workspaceRoot: string;
  private readonly lane: string;
  private readonly ignoredPatterns: string[];
  private readonly debounceMs: number;
  private readonly onDiffStream: (diff: LiveDiffStream) => void;
  private readonly onFocusChange: (filePath: string, action: "editing" | "idle" | "saved") => void;
  private readonly onShadowSync?: (filePath: string, content: string) => void;
  private readonly onShadowDelete?: (filePath: string) => void;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private fileSnapshots: Map<string, string> = new Map();

  constructor(options: WorkspaceDiffWatcherOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.jail = new WorkspaceJail(this.workspaceRoot);
    this.lane = options.lane;
    const userPatterns = options.ignoredPatterns ?? [".nucleus"];
    const combined = new Set([...GLOBAL_NON_BYPASSABLE_IGNORES, ...userPatterns]);
    this.ignoredPatterns = Array.from(combined);
    this.debounceMs = options.debounceMs ?? 300;
    this.onDiffStream = options.onDiffStream;
    this.onFocusChange = options.onFocusChange;
    this.onShadowSync = options.onShadowSync;
    this.onShadowDelete = options.onShadowDelete;
  }

  public start(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.workspaceRoot, { recursive: true }, (eventType, relativeFilename) => {
        if (!relativeFilename) return;
        const normalized = relativeFilename.replace(/\\/g, "/");

        // Ignore excluded folders or binary files early
        if (this.isIgnored(normalized) || this.isBinaryFile(normalized)) return;

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

  public resume(): void {
    if (!this.watcher) {
      this.start();
    }
  }

  public isSensitiveFile(filePath: string): boolean {
    const base = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();

    if (SENSITIVE_EXTENSIONS.has(ext)) return true;

    for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
      if (pattern.test(base)) return true;
    }

    return false;
  }

  public detectSecret(content: string): string | null {
    for (const pattern of OUTBOUND_SECRET_PATTERNS) {
      if (pattern.regex.test(content)) {
        return pattern.name;
      }
    }
    return null;
  }

  public isIgnored(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (this.isSensitiveFile(normalized)) {
      return true;
    }
    for (const pattern of this.ignoredPatterns) {
      if (normalized === pattern || normalized.startsWith(pattern + "/")) {
        return true;
      }
      if (normalized.includes("/" + pattern + "/") || normalized.endsWith("/" + pattern)) {
        return true;
      }
      if (pattern.includes("/") && (normalized.includes(pattern) || normalized.startsWith(pattern))) {
        return true;
      }
    }
    return false;
  }

  public isBinaryFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  public isBinaryContent(buffer: Buffer): boolean {
    const checkLength = Math.min(buffer.length, 1024);
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  }

  private handleFileChange(relativeFilePath: string): void {
    try {
      if (this.isIgnored(relativeFilePath) || this.isBinaryFile(relativeFilePath) || this.isSensitiveFile(relativeFilePath)) return;

      const fullPath = this.jail.resolveSafe(relativeFilePath);
      if (!fs.existsSync(fullPath)) {
        if (this.fileSnapshots.has(relativeFilePath)) {
          const oldContent = this.fileSnapshots.get(relativeFilePath) ?? "";
          this.fileSnapshots.delete(relativeFilePath);
          this.onFocusChange(relativeFilePath, "idle");

          const unifiedDiff = createUnifiedDiff(relativeFilePath, oldContent, "");
          const diffStream: LiveDiffStream = {
            lane: this.lane,
            active_file: relativeFilePath,
            files_changed: [relativeFilePath],
            patch_summary: `Deleted ${path.basename(relativeFilePath)}`,
            diff_hunk: unifiedDiff
          };
          this.onDiffStream(diffStream);
          this.onShadowDelete?.(relativeFilePath);
        }
        return;
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return;

      const buffer = fs.readFileSync(fullPath);
      if (this.isBinaryContent(buffer)) {
        return; // Skip binary content
      }

      const newContent = buffer.toString("utf8");
      const oldContent = this.fileSnapshots.get(relativeFilePath) ?? "";
      this.fileSnapshots.set(relativeFilePath, newContent);

      this.onFocusChange(relativeFilePath, "saved");

      // Guardrail: check for credentials/secrets before streaming outbound
      const detectedSecret = this.detectSecret(newContent);
      if (detectedSecret) {
        console.warn(`[DiffWatcher] ⚠️ Credential guardrail triggered on ${relativeFilePath} (${detectedSecret}). Suppressing outbound diff stream.`);
        const diffStream: LiveDiffStream = {
          lane: this.lane,
          active_file: relativeFilePath,
          files_changed: [relativeFilePath],
          patch_summary: `[Secret Guardrail: ${detectedSecret} detected in ${path.basename(relativeFilePath)}]`,
          diff_hunk: `[POTENTIAL SECRET DETECTED: ${detectedSecret} — DIFF STREAM SUPPRESSED BY DAEMON GUARDRAILS]`
        };
        this.onDiffStream(diffStream);
        return;
      }

      // Generate standard unified line diff hunk
      const unifiedDiff = createUnifiedDiff(relativeFilePath, oldContent, newContent);

      // Calculate line diff summary
      const oldLines = oldContent ? oldContent.split("\n").length : 0;
      const newLines = newContent.split("\n").length;
      const delta = newLines - oldLines;
      const patchSummary = `${delta >= 0 ? `+${delta}` : delta} lines in ${path.basename(relativeFilePath)}`;

      const diffStream: LiveDiffStream = {
        lane: this.lane,
        active_file: relativeFilePath,
        files_changed: [relativeFilePath],
        patch_summary: patchSummary,
        diff_hunk: unifiedDiff.length < 50_000 ? unifiedDiff : "(diff truncated, patch exceeds 50KB)"
      };

      this.onDiffStream(diffStream);

      // Decoupled full shadow file synchronization
      this.onShadowSync?.(relativeFilePath, newContent);
    } catch {
      // Ignore transient file lock / deletion errors during active build
    }
  }
}
