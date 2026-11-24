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
});
