import { z } from "zod";

export const ContractLockRequestSchema = z.object({
  file_path: z.string().min(1),
  ttl_seconds: z.number().int().min(1).max(60).default(15)
});

export const ContractLockGrantSchema = z.object({
  file_path: z.string().min(1),
  holder_id: z.string().min(1),
  lease_expires_at: z.number().int().positive()
});

export const ContractLockReleaseSchema = z.object({
  file_path: z.string().min(1)
});

export const ContractUpdateRequestSchema = z.object({
  file_path: z.string().min(1),
  content: z.string(),
  touched_sections: z.array(z.string()).default([])
});

export const ContractUpdateBroadcastSchema = z.object({
  file_path: z.string().min(1),
  version: z.number().int().positive(),
  content: z.string(),
  touched_sections: z.array(z.string()).default([])
});

export type ContractLockRequest = z.infer<typeof ContractLockRequestSchema>;
export type ContractLockGrant = z.infer<typeof ContractLockGrantSchema>;
export type ContractLockRelease = z.infer<typeof ContractLockReleaseSchema>;
export type ContractUpdateRequest = z.infer<typeof ContractUpdateRequestSchema>;
export type ContractUpdateBroadcast = z.infer<typeof ContractUpdateBroadcastSchema>;
