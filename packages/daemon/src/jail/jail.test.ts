import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WorkspaceJail } from "./jail.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("WorkspaceJail (Security Boundary)", () => {
  const root = path.resolve("test_workspace");
  const jail = new WorkspaceJail(root);

  it("should safely resolve paths inside workspace", () => {
    const resolved = jail.resolveSafe("src/index.ts");
    expect(resolved).toBe(path.resolve(root, "src/index.ts"));
  });

  it("should reject path traversal attempts (../)", () => {
    expect(() => jail.resolveSafe("../secrets.env")).toThrow(/Security Exception/);
  });

  it("should reject sibling directory paths sharing the workspace prefix", () => {
    expect(() => jail.resolveSafe("../test_workspace_secret/credentials.json")).toThrow(/Security Exception/);
    expect(() => jail.resolveSafe("../test_workspace-data/config")).toThrow(/Security Exception/);
  });

  it("should reject absolute paths outside the workspace root", () => {
    const malicious = path.resolve("/etc/passwd");
    expect(() => jail.resolveSafe(malicious)).toThrow(/Security Exception/);
  });

  describe("Symlink & Junction Confinement (Option A)", () => {
    let tempBase: string;
    let wsDir: string;
    let extDir: string;
    let symlinkJail: WorkspaceJail;

    beforeAll(() => {
      tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "jail-symlink-test-"));
      wsDir = path.join(tempBase, "workspace");
      extDir = path.join(tempBase, "external_secrets");
      fs.mkdirSync(wsDir, { recursive: true });
      fs.mkdirSync(extDir, { recursive: true });

      fs.writeFileSync(path.join(extDir, "id_rsa"), "secret-private-key", "utf8");
      fs.writeFileSync(path.join(wsDir, "local.txt"), "local-file", "utf8");

      const internalDir = path.join(wsDir, "internal");
      fs.mkdirSync(internalDir, { recursive: true });
      fs.writeFileSync(path.join(internalDir, "file.txt"), "internal-content", "utf8");

      // Create an internal junction/symlink pointing inside workspace
      const internalLink = path.join(wsDir, "link_to_internal");
      try {
        fs.symlinkSync(internalDir, internalLink, process.platform === "win32" ? "junction" : "dir");
      } catch {}

      // Create an external junction/symlink pointing outside workspace
      const externalLink = path.join(wsDir, "link_to_external");
      try {
        fs.symlinkSync(extDir, externalLink, process.platform === "win32" ? "junction" : "dir");
      } catch {}

      symlinkJail = new WorkspaceJail(wsDir);
    });

    afterAll(() => {
      try {
        fs.rmSync(tempBase, { recursive: true, force: true });
      } catch {}
    });

    it("should allow safe resolution through internal symlinks that stay inside the workspace", () => {
      const internalLink = path.join(wsDir, "link_to_internal");
      if (fs.existsSync(internalLink)) {
        const resolved = symlinkJail.resolveSafe("link_to_internal/file.txt");
        expect(resolved).toBe(path.resolve(wsDir, "link_to_internal/file.txt"));
      }
    });

    it("should block and throw on symlinks/junctions that escape outside the workspace", () => {
      const externalLink = path.join(wsDir, "link_to_external");
      if (fs.existsSync(externalLink)) {
        expect(() => symlinkJail.resolveSafe("link_to_external/id_rsa")).toThrow(/Symlink.*traversal attempt/);
      }
    });
  });
});
