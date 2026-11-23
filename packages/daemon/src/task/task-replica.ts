import fs from "node:fs";
import path from "node:path";
import { WorkspaceJail } from "../jail/jail.js";
import type { TaskItem } from "@nucleus/protocol";

export class TaskBoardReplica {
  private readonly jail: WorkspaceJail;
  private readonly tasksFile: string;
  private tasks: Map<string, TaskItem> = new Map();

  constructor(workspaceRoot: string) {
    this.jail = new WorkspaceJail(workspaceRoot);
    const nucleusDir = this.jail.resolveSafe(".nucleus");
    this.tasksFile = this.jail.resolveSafe(path.join(".nucleus", "tasks.json"));
    fs.mkdirSync(nucleusDir, { recursive: true });
  }

  public applySnapshot(taskList: TaskItem[]): void {
    this.tasks.clear();
    for (const t of taskList) {
      this.tasks.set(t.id, t);
    }
    this.saveToDisk();
  }

  public applyUpdate(task: TaskItem): void {
    this.tasks.set(task.id, task);
    this.saveToDisk();
  }

  public getTask(taskId: string): TaskItem | undefined {
    return this.tasks.get(taskId);
  }

  public getAll(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  private saveToDisk(): void {
    fs.writeFileSync(this.tasksFile, JSON.stringify(this.getAll(), null, 2), "utf8");
  }
}
