import { z } from "zod";

export const LiveDiffStreamSchema = z.object({
  lane: z.string().min(1),
  active_file: z.string().min(1),
  files_changed: z.array(z.string()).default([]),
  patch_summary: z.string(),
  diff_hunk: z.string().optional()
});

export const FileFocusChangeSchema = z.object({
  lane: z.string().min(1),
  file_path: z.string().min(1),
  action: z.enum(["editing", "idle", "saved"])
});

/**
 * Peer-to-Peer / Room-wide Live File Inspection
 * Allows a peer in one lane (e.g., backend) to read a file from another lane (e.g., frontend)
 * directly in real-time through the room daemon WITHOUT requiring a git commit or GitHub push.
 */
export const PeerFileReadRequestSchema = z.object({
  from_node_id: z.string().min(1),
  target_lane: z.string().min(1),
  file_path: z.string().min(1)
});

export const PeerFileReadResponseSchema = z.object({
  target_lane: z.string().min(1),
  file_path: z.string().min(1),
  exists: z.boolean(),
  content: z.string().optional(),
  error: z.string().optional(),
  last_modified: z.number().int().positive().optional()
});

/**
 * Lane Shadow Replica Sync
 * The room can mirror read-only shadow working copies (e.g., .nucleus/shadows/frontend/...)
 * so local AI agents (claude, agy) can directly inspect peer code as local disk files.
 */
export const LaneShadowSyncSchema = z.object({
  source_lane: z.string().min(1),
  file_path: z.string().min(1),
  content: z.string(),
  version: z.number().int().positive()
});

export type LiveDiffStream = z.infer<typeof LiveDiffStreamSchema>;
export type FileFocusChange = z.infer<typeof FileFocusChangeSchema>;
export type PeerFileReadRequest = z.infer<typeof PeerFileReadRequestSchema>;
export type PeerFileReadResponse = z.infer<typeof PeerFileReadResponseSchema>;
export type LaneShadowSync = z.infer<typeof LaneShadowSyncSchema>;
