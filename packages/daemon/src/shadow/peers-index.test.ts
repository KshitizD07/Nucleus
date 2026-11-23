import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PeersIndexManager } from "./peers-index.js";

describe("PeersIndexManager (Agent Context & Template Customization)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "peers-index-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should render default PEERS.md with active peer metadata", () => {
    const manager = new PeersIndexManager(tempDir);
    manager.setPeer({
      nodeId: "node-be-1",
      lane: "backend",
      status: "active",
      activeFile: "src/api/auth.ts"
    });

    const content = fs.readFileSync(manager.getPeersFilePath(), "utf8");
    expect(content).toContain("`backend`");
    expect(content).toContain("`node-be-1`");
    expect(content).toContain("`src/api/auth.ts`");
    expect(content).toContain(".nucleus/shadows/backend/");
    expect(content).toContain("Instructions for AI Coding Agents");
  });

  it("should incorporate custom project guidelines from CONTRACT/peers.template.md", () => {
    const contractDir = path.join(tempDir, "CONTRACT");
    fs.mkdirSync(contractDir, { recursive: true });
    fs.writeFileSync(
      path.join(contractDir, "peers.template.md"),
      "### Custom Rule\nAlways run `npm run typecheck` before pushing.\n",
      "utf8"
    );

    const manager = new PeersIndexManager(tempDir);
    const content = fs.readFileSync(manager.getPeersFilePath(), "utf8");

    expect(content).toContain("## Project-Specific Collaboration Rules");
    expect(content).toContain("Always run `npm run typecheck` before pushing.");
  });

  it("should incorporate custom guidelines from .nucleus/peers.template.md if CONTRACT template is absent", () => {
    const nucleusDir = path.join(tempDir, ".nucleus");
    fs.mkdirSync(nucleusDir, { recursive: true });
    fs.writeFileSync(
      path.join(nucleusDir, "peers.template.md"),
      "### Nucleus Local Rule\nStrictly prefix commits with semantic tags.\n",
      "utf8"
    );

    const manager = new PeersIndexManager(tempDir);
    const content = fs.readFileSync(manager.getPeersFilePath(), "utf8");

    expect(content).toContain("## Project-Specific Collaboration Rules");
    expect(content).toContain("Strictly prefix commits with semantic tags.");
  });
});
