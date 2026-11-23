import { z } from "zod";

export const CriticFindingItemSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  file: z.string().min(1),
  line: z.number().int().optional(),
  message: z.string().min(1),
  suggested_fix: z.string().optional()
});

export const CriticResultSchema = z.object({
  task_id: z.string().min(1),
  lane: z.string().min(1),
  verdict: z.enum(["approved", "changes_requested"]),
  deterministic_checks_passed: z.boolean(),
  findings: z.array(CriticFindingItemSchema).default([]),
  critique_file_path: z.string().min(1)
});

export type CriticFindingItem = z.infer<typeof CriticFindingItemSchema>;
export type CriticResult = z.infer<typeof CriticResultSchema>;
