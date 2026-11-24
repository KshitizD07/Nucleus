import fs from "node:fs";
import path from "node:path";
import type { TaskItem, TaskStatus } from "@nucleus/protocol";
import { TaskItemSchema } from "@nucleus/protocol";

export class TaskBoardManager {
  private readonly tasks: Map<string, TaskItem> = new Map();
  private readonly storagePath: string;
  private readonly archivePath: string;

  constructor(storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.storagePath = path.join(storageDir, "tasks.json");
    this.archivePath = path.join(storageDir, "tasks_archive.json");
    this.loadFromDisk();
  }

  public addTask(task: TaskItem): void {
    const validated = TaskItemSchema.parse(task);
    this.tasks.set(validated.id, validated);
    this.persistToDisk();
  }

  public claimTask(taskId: string, nodeId: string, branch?: string, lane?: string, displayName?: string): { success: boolean; task?: TaskItem; reason?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, reason: `Task ${taskId} not found` };
    }
    if (lane && task.lane !== lane) {
      return {
        success: false,
        reason: `Forbidden: Lane mismatch. Node '${nodeId}' in lane '${lane}' cannot claim task '${taskId}' belonging to lane '${task.lane}'`
      };
    }
    if (task.status === "blocked") {
      return {
        success: false,
        reason: `Task ${taskId} is currently blocked pending completion of preceding turns/tasks.`
      };
    }
    const assignee = displayName || nodeId;
    if (task.assigned_to && task.assigned_to !== assignee && task.assigned_to !== nodeId) {
      return { success: false, reason: `Task ${taskId} is already claimed by ${task.assigned_to}` };
    }

    task.assigned_to = assignee;
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
    if (status === "unassigned") {
      task.assigned_to = null;
    }
    if (branch) task.branch = branch;

    // When a task is approved, auto-unblock any dependent tasks whose requirements are met
    if (status === "approved") {
      for (const other of this.tasks.values()) {
        if (other.status === "blocked" && other.depends_on_contracts && other.depends_on_contracts.length > 0) {
          const allDepsMet = other.depends_on_contracts.every((dep) => {
            if (dep.startsWith("CONTRACT/")) return true;
            const depTask = this.tasks.get(dep);
            return !depTask || depTask.status === "approved";
          });
          if (allDepsMet) {
            other.status = "unassigned";
          }
        }
      }
    }

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

  public getStoragePath(): string {
    return this.storagePath;
  }

  public getArchivePath(): string {
    return this.archivePath;
  }

  public getArchivedTasks(): TaskItem[] {
    if (!fs.existsSync(this.archivePath)) return [];
    try {
      const raw = fs.readFileSync(this.archivePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => TaskItemSchema.parse(item));
      }
    } catch {}
    return [];
  }

  public archiveCompletedTasks(): { archivedCount: number; archivedTasks: TaskItem[] } {
    const toArchive: TaskItem[] = [];
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === "approved") {
        toArchive.push(task);
        this.tasks.delete(id);
      }
    }

    if (toArchive.length > 0) {
      const existing = this.getArchivedTasks();
      const combined = [...existing, ...toArchive];
      fs.writeFileSync(this.archivePath, JSON.stringify(combined, null, 2), "utf8");
      this.persistToDisk();
    }

    return { archivedCount: toArchive.length, archivedTasks: toArchive };
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
