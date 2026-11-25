import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceDiffWatcher, GLOBAL_NON_BYPASSABLE_IGNORES, BINARY_EXTENSIONS } from "./diff-watcher.js";

describe("WorkspaceDiffWatcher Hardened Ignore & Binary Filter", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-watcher-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should enforce global non-bypassable ignores even when empty ignoredPatterns are provided", () => {
    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      ignoredPatterns: [], // Attempting to bypass
      onDiffStream: () => {},
      onFocusChange: () => {}
    });

    // Check all non-bypassable global paths are rejected
    expect(watcher.isIgnored("node_modules/express/index.js")).toBe(true);
    expect(watcher.isIgnored("packages/backend/node_modules/lodash/index.js")).toBe(true);
    expect(watcher.isIgnored(".git/HEAD")).toBe(true);
    expect(watcher.isIgnored("dist/bundle.js")).toBe(true);
    expect(watcher.isIgnored("build/output.js")).toBe(true);
    expect(watcher.isIgnored(".next/server/pages.js")).toBe(true);
    expect(watcher.isIgnored(".nucleus/shadows/frontend/main.tsx")).toBe(true);
    expect(watcher.isIgnored(".cache/webpack/data.json")).toBe(true);

    // Standard source files are NOT ignored
    expect(watcher.isIgnored("src/controllers/auth.ts")).toBe(false);
    expect(watcher.isIgnored("packages/api/routes.js")).toBe(false);
    expect(watcher.isIgnored("CONTRACT/api.md")).toBe(false);
  });

  it("should accurately detect and reject binary files based on extension", () => {
    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "frontend",
      onDiffStream: () => {},
      onFocusChange: () => {}
    });

    expect(watcher.isBinaryFile("assets/logo.png")).toBe(true);
    expect(watcher.isBinaryFile("images/photo.jpeg")).toBe(true);
    expect(watcher.isBinaryFile("fonts/inter.woff2")).toBe(true);
    expect(watcher.isBinaryFile("bin/server.exe")).toBe(true);
    expect(watcher.isBinaryFile("archive.zip")).toBe(true);
    expect(watcher.isBinaryFile("data.wasm")).toBe(true);

    // Code files are not binary
    expect(watcher.isBinaryFile("src/index.ts")).toBe(false);
    expect(watcher.isBinaryFile("package.json")).toBe(false);
    expect(watcher.isBinaryFile("README.md")).toBe(false);
  });

  it("should detect binary content containing null bytes", () => {
    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      onDiffStream: () => {},
      onFocusChange: () => {}
    });

    const textBuffer = Buffer.from("console.log('Hello world');\nconst x = 123;", "utf8");
    expect(watcher.isBinaryContent(textBuffer)).toBe(false);

    const binaryBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00, 0x00]); // ELF header with nulls
    expect(watcher.isBinaryContent(binaryBuffer)).toBe(true);
  });

  it("should ignore and block sensitive credential files from diff watching", () => {
    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      onDiffStream: () => {},
      onFocusChange: () => {}
    });

    // Sensitive files are automatically ignored
    expect(watcher.isSensitiveFile(".env")).toBe(true);
    expect(watcher.isSensitiveFile(".env.local")).toBe(true);
    expect(watcher.isSensitiveFile(".env.production")).toBe(true);
    expect(watcher.isSensitiveFile(".npmrc")).toBe(true);
    expect(watcher.isSensitiveFile(".pypirc")).toBe(true);
    expect(watcher.isSensitiveFile("id_rsa")).toBe(true);
    expect(watcher.isSensitiveFile("id_ed25519")).toBe(true);
    expect(watcher.isSensitiveFile("credentials.json")).toBe(true);
    expect(watcher.isSensitiveFile("server.key")).toBe(true);
    expect(watcher.isSensitiveFile("cert.pem")).toBe(true);

    // Also verify via isIgnored()
    expect(watcher.isIgnored(".env")).toBe(true);
    expect(watcher.isIgnored("config/.env.test")).toBe(true);
    expect(watcher.isIgnored("secrets/id_rsa")).toBe(true);

    // Normal files not marked sensitive
    expect(watcher.isSensitiveFile("src/index.ts")).toBe(false);
    expect(watcher.isSensitiveFile("CONTRACT/api.md")).toBe(false);
  });

  it("should detect hardcoded secrets and suppress outbound diff_hunk", async () => {
    let capturedDiff: any = null;

    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      debounceMs: 50,
      onDiffStream: (diff) => {
        capturedDiff = diff;
      },
      onFocusChange: () => {}
    });

    watcher.start();

    // Create a file containing an AWS secret key
    const testFile = path.join(tempDir, "leak.ts");
    fs.writeFileSync(testFile, 'const AWS_KEY = "AKIA1234567890ABCDEF";\nconsole.log(AWS_KEY);', "utf8");

    // Allow watcher debounce to process
    await new Promise((r) => setTimeout(r, 200));

    expect(capturedDiff).not.toBeNull();
    expect(capturedDiff.active_file).toBe("leak.ts");
    // Raw AWS key must NOT be transmitted in diff_hunk
    expect(capturedDiff.diff_hunk).not.toContain("AKIA1234567890ABCDEF");
    expect(capturedDiff.diff_hunk).toContain("[POTENTIAL SECRET DETECTED: AWS Access Key ID — DIFF STREAM SUPPRESSED BY DAEMON GUARDRAILS]");

    watcher.stop();
  });

  it("should stream unified line diffs for file edits and handle deletions", async () => {
    let capturedDiff: any = null;
    let deletedFile: string | null = null;
    let syncedContent: string | null = null;

    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      debounceMs: 50,
      onDiffStream: (diff) => {
        capturedDiff = diff;
      },
      onShadowSync: (_file, content) => {
        syncedContent = content;
      },
      onShadowDelete: (file) => {
        deletedFile = file;
      },
      onFocusChange: () => {}
    });

    watcher.start();

    // 1. File creation
    const testFile = path.join(tempDir, "calc.ts");
    fs.writeFileSync(testFile, "line1\nline2\n", "utf8");

    await new Promise((r) => setTimeout(r, 200));

    expect(capturedDiff).not.toBeNull();
    expect(capturedDiff.diff_hunk).toContain("--- /dev/null");
    expect(capturedDiff.diff_hunk).toContain("+++ b/calc.ts");
    expect(capturedDiff.diff_hunk).toContain("+line1");
    expect(capturedDiff.diff_hunk).toContain("+line2");
    expect(syncedContent).toBe("line1\nline2\n");

    // 2. File modification (only line 2 changed)
    capturedDiff = null;
    fs.writeFileSync(testFile, "line1\nline2_modified\n", "utf8");

    await new Promise((r) => setTimeout(r, 200));

    expect(capturedDiff).not.toBeNull();
    expect(capturedDiff.diff_hunk).toContain("--- a/calc.ts");
    expect(capturedDiff.diff_hunk).toContain("+++ b/calc.ts");
    expect(capturedDiff.diff_hunk).toContain("-line2");
    expect(capturedDiff.diff_hunk).toContain("+line2_modified");
    expect(capturedDiff.diff_hunk).toContain(" line1"); // Context line
    expect(syncedContent).toBe("line1\nline2_modified\n");

    // 3. File deletion
    capturedDiff = null;
    fs.unlinkSync(testFile);

    await new Promise((r) => setTimeout(r, 200));

    expect(capturedDiff).not.toBeNull();
    expect(capturedDiff.diff_hunk).toContain("--- a/calc.ts");
    expect(capturedDiff.diff_hunk).toContain("+++ /dev/null");
    expect(deletedFile).toBe("calc.ts");

    watcher.stop();
  });

  it("should decouple shadow sync from diff truncation for files larger than 50KB", async () => {
    let capturedDiff: any = null;
    let syncedContent: string | null = null;

    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      debounceMs: 50,
      onDiffStream: (diff) => {
        capturedDiff = diff;
      },
      onShadowSync: (_file, content) => {
        syncedContent = content;
      },
      onFocusChange: () => {}
    });

    watcher.start();

    // Generate a file larger than 50KB (e.g. 65KB)
    const largeContent = "// Header\n" + "console.log('padding line');\n".repeat(2500);
    expect(largeContent.length).toBeGreaterThan(50_000);

    const testFile = path.join(tempDir, "large.ts");
    fs.writeFileSync(testFile, largeContent, "utf8");

    await new Promise((r) => setTimeout(r, 200));

    expect(capturedDiff).not.toBeNull();
    // Diff hunk for 65KB diff is truncated to keep websocket frames lightweight
    expect(capturedDiff.diff_hunk).toBe("(diff truncated, patch exceeds 50KB)");

    // Crucially: shadow sync receives full, untruncated content!
    const finalContent: string = syncedContent ?? "";
    expect(finalContent.length).toBe(largeContent.length);
    expect(finalContent).toBe(largeContent);

    watcher.stop();
  });

  it("should perform initial workspace scan on start and sync pre-existing files", async () => {
    // 1. Pre-create existing files in workspace before starting watcher
    const preExistingFile = path.join(tempDir, "src", "existing.ts");
    fs.mkdirSync(path.dirname(preExistingFile), { recursive: true });
    fs.writeFileSync(preExistingFile, "const a = 1;\nconst b = 2;\n", "utf8");

    // Also create an ignored file and a sensitive file to verify exclusion
    const nodeModulesFile = path.join(tempDir, "node_modules", "pkg", "index.js");
    fs.mkdirSync(path.dirname(nodeModulesFile), { recursive: true });
    fs.writeFileSync(nodeModulesFile, "module.exports = {};", "utf8");

    const envFile = path.join(tempDir, ".env");
    fs.writeFileSync(envFile, "SECRET=123", "utf8");

    const syncedFiles: Record<string, string> = {};
    let diffStreamCalled = false;

    const watcher = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      debounceMs: 50,
      onDiffStream: () => {
        diffStreamCalled = true;
      },
      onShadowSync: (filePath, content) => {
        syncedFiles[filePath] = content;
      },
      onFocusChange: () => {}
    });

    watcher.start();

    // Verify initial scan results:
    // - Pre-existing file was scanned and synced into shadow
    expect(syncedFiles["src/existing.ts"]).toBe("const a = 1;\nconst b = 2;\n");
    // - fileSnapshots was populated
    expect(watcher.getSnapshot("src/existing.ts")).toBe("const a = 1;\nconst b = 2;\n");
    // - Ignored & sensitive files were skipped
    expect(syncedFiles["node_modules/pkg/index.js"]).toBeUndefined();
    expect(syncedFiles[".env"]).toBeUndefined();
    // - No diff stream event spammed for unchanged files
    expect(diffStreamCalled).toBe(false);

    // 2. Now modify the pre-existing file: it should produce a REAL line diff, not an initial addition
    let capturedDiff: any = null;
    const watcher2 = new WorkspaceDiffWatcher({
      workspaceRoot: tempDir,
      lane: "backend",
      debounceMs: 50,
      onDiffStream: (diff) => {
        capturedDiff = diff;
      },
      onFocusChange: () => {}
    });
    // Start watcher2 (which will scan and snapshot existing.ts)
    watcher2.start();

    fs.writeFileSync(preExistingFile, "const a = 1;\nconst b = 999;\n", "utf8");
    await new Promise((r) => setTimeout(r, 200));

    expect(capturedDiff).not.toBeNull();
    expect(capturedDiff.diff_hunk).toContain("--- a/src/existing.ts");
    expect(capturedDiff.diff_hunk).toContain("+++ b/src/existing.ts");
    expect(capturedDiff.diff_hunk).toContain("-const b = 2;");
    expect(capturedDiff.diff_hunk).toContain("+const b = 999;");
    expect(capturedDiff.diff_hunk).toContain(" const a = 1;"); // Context preserved!

    watcher.stop();
    watcher2.stop();
  });
});
