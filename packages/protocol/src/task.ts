import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "unassigned",
  "assigned",
  "active",
  "in_review",
  "changes_requested",
  "approved",
  "blocked"
]);

export const TaskItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  lane: z.string().min(1),
  status: TaskStatusSchema,
  assigned_to: z.string().nullable().default(null),
  depends_on_contracts: z.array(z.string()).default([]),
  branch: z.string().optional(),
  description: z.string().optional(),
  spec_file: z.string().optional(),
  spec_url: z.string().optional()
});

export const TaskClaimSchema = z.object({
  task_id: z.string().min(1),
  node_id: z.string().min(1),
  display_name: z.string().optional()
});

export const TaskStatusUpdateSchema = z.object({
  task_id: z.string().min(1),
  status: TaskStatusSchema,
  branch: z.string().optional()
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;
export type TaskClaim = z.infer<typeof TaskClaimSchema>;
export type TaskStatusUpdate = z.infer<typeof TaskStatusUpdateSchema>;
