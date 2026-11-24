import { describe, it, expect } from "vitest";
import {
  MessageEnvelopeSchema,
  ContractLockRequestSchema,
  TaskItemSchema,
  LiveDiffStreamSchema,
  HelloPayloadSchema,
  HeartbeatPayloadSchema,
  SeveredPayloadSchema
} from "@nucleus/protocol";

describe("Protocol Envelopes and Schemas", () => {
  it("should validate a valid message envelope", () => {
    const raw = {
      room_id: "room-alpha",
      node_id: "node-123",
      ts: Date.now(),
      type: "sharing:live_diff_stream",
      payload: {
        lane: "backend",
        active_file: "src/auth.ts",
        files_changed: ["src/auth.ts"],
        patch_summary: "+10 -2 lines"
      },
      sig: "sig_abc"
    };

    const parsed = MessageEnvelopeSchema.parse(raw);
    expect(parsed.room_id).toBe("room-alpha");
    expect(parsed.type).toBe("sharing:live_diff_stream");
  });

  it("should reject an invalid contract lock request", () => {
    const invalidLock = {
      file_path: "",
      ttl_seconds: 100 // exceeds max of 60
    };

    expect(() => ContractLockRequestSchema.parse(invalidLock)).toThrow();
  });

  it("should parse task status and spec fields correctly", () => {
    const task = {
      id: "task-01",
      title: "Implement auth middleware",
      lane: "backend",
      status: "active" as const,
      assigned_to: "Aryan",
      depends_on_contracts: ["api.md"],
      spec_file: "CONTRACT/specs/auth.md",
      spec_url: "https://figma.com/file/123",
      description: "Detailed description of JWT requirements"
    };

    const parsed = TaskItemSchema.parse(task);
    expect(parsed.status).toBe("active");
    expect(parsed.spec_file).toBe("CONTRACT/specs/auth.md");
    expect(parsed.spec_url).toBe("https://figma.com/file/123");
    expect(parsed.description).toBe("Detailed description of JWT requirements");
  });

  it("should validate live diff stream frame", () => {
    const frame = {
      lane: "frontend",
      active_file: "src/Login.tsx",
      files_changed: ["src/Login.tsx", "src/api.ts"],
      patch_summary: "+25 lines (form validation)"
    };

    const parsed = LiveDiffStreamSchema.parse(frame);
    expect(parsed.lane).toBe("frontend");
    expect(parsed.files_changed.length).toBe(2);
  });
});

describe("Session Schemas", () => {
  it("should parse a valid hello payload", () => {
    const hello = {
      node_id: "node-abc",
      join_token: "tok-xyz",
      workspace_path: "/home/aryan/opendoor",
      lane: "backend",
      capabilities: { cli: "claude-code", platform: "linux", version: "1.0.0" }
    };
    const parsed = HelloPayloadSchema.parse(hello);
    expect(parsed.lane).toBe("backend");
    expect(parsed.capabilities.cli).toBe("claude-code");
  });

  it("should apply defaults to heartbeat payload", () => {
    const hb = { status: "active" as const };
    const parsed = HeartbeatPayloadSchema.parse(hb);
    expect(parsed.task_id).toBeNull();
    expect(parsed.contract_version).toBe(0);
    expect(parsed.active_file).toBeNull();
  });

  it("should parse severed payload with default reason", () => {
    const severed = { node_id: "node-abc" };
    const parsed = SeveredPayloadSchema.parse(severed);
    expect(parsed.reason).toBe("user_exit");
  });
});
