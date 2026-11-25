import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ContractReplica } from "./contract-replica.js";

describe("ContractReplica (Persistence across restarts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "contract-replica-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should apply contract update and persist version across restarts", () => {
    const replica1 = new ContractReplica({ workspaceRoot: tempDir });

    const applied = replica1.applyUpdate({
      file_path: "api.md",
      version: 3,
      content: "# API v3\n\nEndpoint specs.",
      touched_sections: []
    });

    expect(applied.applied).toBe(true);
    expect(replica1.getVersion("api.md")).toBe(3);
    expect(replica1.readFile("api.md")).toContain("# API v3");

    // Simulate daemon restart
    const replica2 = new ContractReplica({ workspaceRoot: tempDir });
    expect(replica2.getVersion("api.md")).toBe(3);

    // Stale version 2 must be rejected
    const stale = replica2.applyUpdate({
      file_path: "api.md",
      version: 2,
      content: "# Stale v2",
      touched_sections: []
    });
    expect(stale.applied).toBe(false);

    // Newer version 4 must be accepted
    const fresh = replica2.applyUpdate({
      file_path: "api.md",
      version: 4,
      content: "# API v4",
      touched_sections: []
    });
    expect(fresh.applied).toBe(true);
    expect(replica2.getVersion("api.md")).toBe(4);
  });
});
