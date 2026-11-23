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

export type LiveDiffStream = z.infer<typeof LiveDiffStreamSchema>;
export type FileFocusChange = z.infer<typeof FileFocusChangeSchema>;
