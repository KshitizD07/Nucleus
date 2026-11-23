import { describe, it, expect } from "vitest";
import {
  MessageEnvelopeSchema,
  ContractLockRequestSchema,
  TaskItemSchema,
  LiveDiffStreamSchema
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

  it("should parse task status correctly", () => {
    const task = {
      id: "task-01",
      title: "Implement auth middleware",
      lane: "backend",
      status: "active" as const,
      assigned_to: "Aryan",
      depends_on_contracts: ["api.md"]
    };

    const parsed = TaskItemSchema.parse(task);
    expect(parsed.status).toBe("active");
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
