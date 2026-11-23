import { describe, it, expect } from "vitest";
import { WorkspaceJail } from "./jail.js";
import path from "node:path";

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

  it("should reject absolute paths outside the workspace root", () => {
    const malicious = path.resolve("/etc/passwd");
    expect(() => jail.resolveSafe(malicious)).toThrow(/Security Exception/);
  });
});
