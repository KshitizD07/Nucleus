import { z } from "zod";

export const NodeCapabilitiesSchema = z.object({
  cli: z.string().default("unknown"),       // "claude-code" | "antigravity" | "aider"
  platform: z.string().default("unknown"),  // "win32" | "linux" | "darwin"
  version: z.string().default("0.0.0")
});

export const HelloPayloadSchema = z.object({
  node_id: z.string().min(1),
  join_token: z.string().min(1),
  workspace_path: z.string().min(1),
  lane: z.string().min(1),
  capabilities: NodeCapabilitiesSchema.default({})
});

export const RoomSnapshotPayloadSchema = z.object({
  room_id: z.string().min(1),
  initiator_id: z.string().min(1),
  peers: z.array(z.object({
    node_id: z.string(),
    lane: z.string(),
    status: z.enum(["idle", "active", "review"])
  })),
  contract_version: z.number().int().nonnegative().default(0),
  task_count: z.number().int().nonnegative().default(0)
});

export const HeartbeatPayloadSchema = z.object({
  status: z.enum(["idle", "active", "review"]),
  task_id: z.string().nullable().default(null),
  contract_version: z.number().int().nonnegative().default(0),
  active_file: z.string().nullable().default(null)
});

export const SeveredPayloadSchema = z.object({
  node_id: z.string().min(1),
  reason: z.enum(["user_exit", "timeout", "kicked"]).default("user_exit")
});

export type NodeCapabilities = z.infer<typeof NodeCapabilitiesSchema>;
export type HelloPayload = z.infer<typeof HelloPayloadSchema>;
export type RoomSnapshotPayload = z.infer<typeof RoomSnapshotPayloadSchema>;
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;
export type SeveredPayload = z.infer<typeof SeveredPayloadSchema>;
