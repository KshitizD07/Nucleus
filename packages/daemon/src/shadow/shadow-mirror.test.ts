import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ShadowMirror } from "./shadow-mirror.js";

describe("ShadowMirror (Sync and Deletion)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-mirror-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should write and read shadow files safely", () => {
    const mirror = new ShadowMirror(tempDir);
    const content = "export const x = 42;";

    const res = mirror.applySync({
      source_lane: "backend",
      file_path: "src/utils.ts",
      content,
      version: 1
    });

    expect(res.applied).toBe(true);
    expect(mirror.readShadowFile("backend", "src/utils.ts")).toBe(content);
  });

  it("should reject stale shadow sync versions", () => {
    const mirror = new ShadowMirror(tempDir);

    mirror.applySync({
      source_lane: "backend",
      file_path: "src/utils.ts",
      content: "v2 content",
      version: 2
    });

    const staleRes = mirror.applySync({
      source_lane: "backend",
      file_path: "src/utils.ts",
      content: "v1 content",
      version: 1
    });

    expect(staleRes.applied).toBe(false);
    expect(mirror.readShadowFile("backend", "src/utils.ts")).toBe("v2 content");
  });

  it("should delete shadow files and clean up empty parent directories", () => {
    const mirror = new ShadowMirror(tempDir);

    mirror.applySync({
      source_lane: "frontend",
      file_path: "nested/dir/button.tsx",
      content: "export const Button = () => null;",
      version: 1
    });

    expect(mirror.readShadowFile("frontend", "nested/dir/button.tsx")).not.toBeNull();

    const deleted = mirror.deleteShadowFile("frontend", "nested/dir/button.tsx", 2);
    expect(deleted).toBe(true);
    expect(mirror.readShadowFile("frontend", "nested/dir/button.tsx")).toBeNull();

    // The nested directory should be pruned
    const nestedDir = path.join(tempDir, ".nucleus", "shadows", "frontend", "nested");
    expect(fs.existsSync(nestedDir)).toBe(false);
  });

  it("should reject stale deletions if a newer sync already landed", () => {
    const mirror = new ShadowMirror(tempDir);

    mirror.applySync({
      source_lane: "frontend",
      file_path: "index.ts",
      content: "v3",
      version: 3
    });

    const deleted = mirror.deleteShadowFile("frontend", "index.ts", 2);
    expect(deleted).toBe(false);
    expect(mirror.readShadowFile("frontend", "index.ts")).toBe("v3");
  });

  it("should persist version manifest across restarts and reject stale syncs after re-instantiation", () => {
    const mirror1 = new ShadowMirror(tempDir);
    mirror1.applySync({
      source_lane: "backend",
      file_path: "api/routes.ts",
      content: "version 5 code",
      version: 5
    });

    // Simulate daemon restart by instantiating a fresh ShadowMirror
    const mirror2 = new ShadowMirror(tempDir);

    // Stale sync v4 must be rejected because v5 was persisted!
    const staleRes = mirror2.applySync({
      source_lane: "backend",
      file_path: "api/routes.ts",
      content: "version 4 code",
      version: 4
    });

    expect(staleRes.applied).toBe(false);
    expect(mirror2.readShadowFile("backend", "api/routes.ts")).toBe("version 5 code");

    // Newer sync v6 must be accepted
    const freshRes = mirror2.applySync({
      source_lane: "backend",
      file_path: "api/routes.ts",
      content: "version 6 code",
      version: 6
    });

    expect(freshRes.applied).toBe(true);
    expect(mirror2.readShadowFile("backend", "api/routes.ts")).toBe("version 6 code");
  });
});
