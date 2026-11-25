import fs from "node:fs";
import path from "node:path";
import { WorkspaceJail } from "../jail/jail.js";
import type { TaskItem } from "@nucleus/protocol";

export class TaskBoardReplica {
  private readonly jail: WorkspaceJail;
  private readonly tasksFile: string;
  private readonly archiveFile: string;
  private tasks: Map<string, TaskItem> = new Map();

  constructor(workspaceRoot: string) {
    this.jail = new WorkspaceJail(workspaceRoot);
    const nucleusDir = this.jail.resolveSafe(".nucleus");
    this.tasksFile = this.jail.resolveSafe(path.join(".nucleus", "tasks.json"));
    this.archiveFile = this.jail.resolveSafe(path.join(".nucleus", "tasks_archive.json"));
    fs.mkdirSync(nucleusDir, { recursive: true });
  }

  public applySnapshot(taskList: TaskItem[]): void {
    this.tasks.clear();
    for (const t of taskList) {
      this.tasks.set(t.id, t);
    }
    this.saveToDisk();
  }

  public applyUpdate(task: TaskItem): boolean {
    const existing = this.tasks.get(task.id);
    if (existing && existing.revision !== undefined && task.revision !== undefined) {
      if (task.revision < existing.revision) {
        return false; // Reject stale out-of-order update
      }
    }
    this.tasks.set(task.id, task);
    this.saveToDisk();
    return true;
  }

  public getTask(taskId: string): TaskItem | undefined {
    return this.tasks.get(taskId);
  }

  public getAll(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  private atomicWriteJson(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
    );
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }

  public getArchivedTasks(): TaskItem[] {
    if (!fs.existsSync(this.archiveFile)) return [];
    try {
      const raw = fs.readFileSync(this.archiveFile, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [];
  }

  public archiveCompletedTasks(): TaskItem[] {
    const toArchive: TaskItem[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === "approved") {
        toArchive.push(task);
      }
    }

    if (toArchive.length > 0) {
      const existing = this.getArchivedTasks();
      const existingIds = new Set(existing.map((t) => t.id));
      const combined = [...existing];
      for (const t of toArchive) {
        if (!existingIds.has(t.id)) combined.push(t);
      }
      this.atomicWriteJson(this.archiveFile, combined);

      for (const t of toArchive) {
        this.tasks.delete(t.id);
      }
      this.saveToDisk();
    }

    return toArchive;
  }

  private saveToDisk(): void {
    this.atomicWriteJson(this.tasksFile, this.getAll());
  }
}
