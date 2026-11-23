import fs from "node:fs";
import path from "node:path";
import type { TaskItem, TaskStatus } from "@nucleus/protocol";
import { TaskItemSchema } from "@nucleus/protocol";

export class TaskBoardManager {
  private readonly tasks: Map<string, TaskItem> = new Map();
  private readonly storagePath: string;

  constructor(storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.storagePath = path.join(storageDir, "tasks.json");
    this.loadFromDisk();
  }

  public addTask(task: TaskItem): void {
    const validated = TaskItemSchema.parse(task);
    this.tasks.set(validated.id, validated);
    this.persistToDisk();
  }

  public claimTask(taskId: string, nodeId: string, branch?: string): { success: boolean; task?: TaskItem; reason?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, reason: `Task ${taskId} not found` };
    }
    if (task.assigned_to && task.assigned_to !== nodeId) {
      return { success: false, reason: `Task ${taskId} is already claimed by ${task.assigned_to}` };
    }

    task.assigned_to = nodeId;
    task.status = "active";
    if (branch) task.branch = branch;

    this.persistToDisk();
    return { success: true, task };
  }

  public updateStatus(taskId: string, status: TaskStatus, branch?: string): { success: boolean; task?: TaskItem; reason?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, reason: `Task ${taskId} not found` };
    }

    task.status = status;
    if (branch) task.branch = branch;

    this.persistToDisk();
    return { success: true, task };
  }

  public getTask(taskId: string): TaskItem | undefined {
    return this.tasks.get(taskId);
  }

  public getAll(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  public getByLane(lane: string): TaskItem[] {
    return this.getAll().filter((t) => t.lane === lane);
  }

  private persistToDisk(): void {
    const data = JSON.stringify(this.getAll(), null, 2);
    fs.writeFileSync(this.storagePath, data, "utf8");
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.storagePath)) return;
    try {
      const raw = fs.readFileSync(this.storagePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const validated = TaskItemSchema.parse(item);
          this.tasks.set(validated.id, validated);
        }
      }
    } catch {
      // Ignore initial parse errors on empty or unformatted file
    }
  }
}
