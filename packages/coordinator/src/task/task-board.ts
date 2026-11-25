import fs from "node:fs";
import path from "node:path";
import type { TaskItem, TaskStatus } from "@nucleus/protocol";
import { TaskItemSchema } from "@nucleus/protocol";

export const LEGAL_TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  blocked: ["unassigned"],
  unassigned: ["active", "assigned"],
  assigned: ["active", "unassigned"],
  active: ["in_review", "unassigned"],
  in_review: ["approved", "changes_requested", "active", "unassigned"],
  changes_requested: ["active", "in_review", "unassigned"],
  approved: [] // Terminal state
};

export interface ContractStoreLike {
  get(filePath: string): { filePath: string; content: string; version: number } | undefined;
}

export class TaskBoardManager {
  private readonly tasks: Map<string, TaskItem> = new Map();
  private readonly storagePath: string;
  private readonly archivePath: string;
  private readonly contractStore?: ContractStoreLike;

  constructor(storageDir: string, contractStore?: ContractStoreLike) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.storagePath = path.join(storageDir, "tasks.json");
    this.archivePath = path.join(storageDir, "tasks_archive.json");
    this.contractStore = contractStore;
    this.loadFromDisk();
  }

  public isContractRef(dep: string): boolean {
    if (/^CONTRACT\//i.test(dep)) return true;
    const clean = dep.split("@")[0].trim();
    const ext = path.extname(clean).toLowerCase();
    if ([".md", ".json", ".yaml", ".yml", ".txt"].includes(ext)) return true;
    if (this.contractStore && this.contractStore.get(clean) !== undefined) return true;
    return false;
  }

  public parseContractRef(dep: string): { filePath: string; requiredVersion: number } {
    let clean = dep.replace(/^CONTRACT\//i, "").trim();
    let requiredVersion = 1;
    if (clean.includes("@")) {
      const parts = clean.split("@");
      clean = parts[0].trim();
      const ver = parseInt(parts[1].trim(), 10);
      if (!isNaN(ver) && ver > 0) {
        requiredVersion = ver;
      }
    }
    return { filePath: clean, requiredVersion };
  }

  public isContractSatisfied(dep: string): boolean {
    const { filePath, requiredVersion } = this.parseContractRef(dep);
    if (this.contractStore) {
      const entry = this.contractStore.get(filePath);
      if (!entry) return false;
      return entry.version >= requiredVersion && entry.content.trim().length > 0;
    }

    const directPath = path.resolve(filePath);
    const contractDirPath = path.resolve("CONTRACT", filePath);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return fs.readFileSync(directPath, "utf8").trim().length > 0;
    }
    if (fs.existsSync(contractDirPath) && fs.statSync(contractDirPath).isFile()) {
      return fs.readFileSync(contractDirPath, "utf8").trim().length > 0;
    }
    return false;
  }

  public areDependenciesMet(task: TaskItem): boolean {
    if (!task.depends_on_contracts || task.depends_on_contracts.length === 0) {
      return true;
    }
    return task.depends_on_contracts.every((dep) => {
      if (this.isContractRef(dep)) {
        return this.isContractSatisfied(dep);
      }
      const depTask = this.tasks.get(dep);
      return depTask !== undefined && depTask.status === "approved";
    });
  }

  public evaluateUnblockedTasks(): TaskItem[] {
    const unblockedTasks: TaskItem[] = [];
    for (const other of this.tasks.values()) {
      if (other.status === "blocked" && other.depends_on_contracts && other.depends_on_contracts.length > 0) {
        if (this.areDependenciesMet(other)) {
          other.status = "unassigned";
          other.revision = (other.revision ?? 1) + 1;
          unblockedTasks.push(other);
        }
      }
    }
    if (unblockedTasks.length > 0) {
      this.persistToDisk();
    }
    return unblockedTasks;
  }

  private detectCycle(newTaskId: string, newDependencies: string[]): void {
    const visited = new Set<string>();
    const recStack: string[] = [newTaskId];

    const getDeps = (id: string): string[] => {
      if (id === newTaskId) {
        return newDependencies;
      }
      return this.tasks.get(id)?.depends_on_contracts ?? [];
    };

    const dfs = (currId: string): boolean => {
      const deps = getDeps(currId);
      for (const dep of deps) {
        if (this.isContractRef(dep)) continue;

        if (dep === newTaskId) {
          recStack.push(dep);
          return true;
        }

        if (!visited.has(dep)) {
          visited.add(dep);
          recStack.push(dep);
          if (dfs(dep)) {
            return true;
          }
          recStack.pop();
        }
      }
      return false;
    };

    if (dfs(newTaskId)) {
      throw new Error(`Dependency cycle detected: ${recStack.join(" -> ")}`);
    }
  }

  public validateGraphAcyclic(): void {
    for (const [id, task] of this.tasks.entries()) {
      this.detectCycle(id, task.depends_on_contracts ?? []);
    }
  }

  public addTask(task: TaskItem): void {
    const validated = TaskItemSchema.parse({
      ...task,
      revision: task.revision ?? 1
    });

    if (validated.depends_on_contracts && validated.depends_on_contracts.includes(validated.id)) {
      throw new Error(`Invalid task dependency: Task '${validated.id}' cannot depend on itself`);
    }

    if (validated.depends_on_contracts) {
      for (const dep of validated.depends_on_contracts) {
        if (!this.isContractRef(dep)) {
          if (!this.tasks.has(dep)) {
            throw new Error(
              `Invalid task dependency: Referenced task '${dep}' does not exist in task board (strict topological order required)`
            );
          }
        }
      }
    }

    this.detectCycle(validated.id, validated.depends_on_contracts ?? []);

    this.tasks.set(validated.id, validated);
    this.persistToDisk();
  }

  public claimTask(
    taskId: string,
    nodeId: string,
    branch?: string,
    lane?: string,
    displayName?: string,
    expectedRevision?: number
  ): { success: boolean; task?: TaskItem; reason?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, reason: `Task ${taskId} not found` };
    }
    if (expectedRevision !== undefined && task.revision !== undefined && task.revision !== expectedRevision) {
      return {
        success: false,
        reason: `Conflict: Stale task revision ${expectedRevision} (current: ${task.revision})`
      };
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
    if (task.status === "approved") {
      return {
        success: false,
        reason: `Task ${taskId} is already approved and completed.`
      };
    }
    if (task.status === "in_review") {
      return {
        success: false,
        reason: `Task ${taskId} is currently submitted for review.`
      };
    }
    const assignee = displayName ? `${displayName} (${nodeId})` : nodeId;
    if (task.assigned_node_id && task.assigned_node_id !== nodeId) {
      return {
        success: false,
        reason: `Task ${taskId} is already claimed by ${task.assigned_name || task.assigned_to || task.assigned_node_id}`
      };
    }
    if (!task.assigned_node_id && task.assigned_to && task.assigned_to !== assignee && task.assigned_to !== nodeId) {
      return { success: false, reason: `Task ${taskId} is already claimed by ${task.assigned_to}` };
    }

    task.assigned_node_id = nodeId;
    task.assigned_name = displayName || nodeId;
    task.assigned_to = assignee;
    task.status = "active";
    task.revision = (task.revision ?? 1) + 1;
    if (branch) task.branch = branch;

    this.persistToDisk();
    return { success: true, task };
  }

  public updateStatus(
    taskId: string,
    status: TaskStatus,
    branch?: string,
    expectedRevision?: number,
    force = false
  ): {
    success: boolean;
    task?: TaskItem;
    reason?: string;
    unblockedTasks?: TaskItem[];
    spawnedTasks?: TaskItem[];
  } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, reason: `Task ${taskId} not found` };
    }
    if (expectedRevision !== undefined && task.revision !== undefined && task.revision !== expectedRevision) {
      return {
        success: false,
        reason: `Conflict: Stale task revision ${expectedRevision} (current: ${task.revision})`
      };
    }

    if (!force && status !== task.status) {
      const allowed = LEGAL_TASK_TRANSITIONS[task.status] ?? [];
      if (!allowed.includes(status)) {
        return {
          success: false,
          reason: `Illegal task transition: Cannot move task '${taskId}' from '${task.status}' to '${status}'`
        };
      }
    }

    task.status = status;
    task.revision = (task.revision ?? 1) + 1;
    if (status === "unassigned") {
      task.assigned_to = null;
      task.assigned_node_id = null;
      task.assigned_name = null;
    }
    if (branch) task.branch = branch;

    const unblockedTasks: TaskItem[] = [];
    const spawnedTasks: TaskItem[] = [];

    // When a task is approved, auto-unblock any dependent tasks whose requirements are met
    if (status === "approved") {
      const unblocked = this.evaluateUnblockedTasks();
      unblockedTasks.push(...unblocked);

      // Dynamic Dialectic Evolution: If a contra round is approved, check if next round pair should spawn
      const contraMatch = taskId.match(/^round-(\d+)-contra$/i);
      if (contraMatch) {
        const roundNum = parseInt(contraMatch[1], 10);
        const nextRoundNum = roundNum + 1;
        const nextProId = `round-${String(nextRoundNum).padStart(2, "0")}-pro`;
        const nextContraId = `round-${String(nextRoundNum).padStart(2, "0")}-contra`;

        const hasSynthesis = Array.from(this.tasks.values()).some((t) => t.lane === "judge" && t.status === "approved");
        if (!this.tasks.has(nextProId) && !hasSynthesis && nextRoundNum <= 50) {
          const proTask: TaskItem = {
            id: nextProId,
            title: `Round ${nextRoundNum} (Pro): Defense & Deeper Argument [Natural Prose, 100-180 words]`,
            lane: "pro",
            status: "unassigned",
            assigned_to: null,
            depends_on_contracts: [taskId],
            description: `Address Contra's critique from round ${roundNum}. Advance your argument naturally in 1-2 paragraphs using vivid analogies. Avoid rigid headings.`
          };
          const contraTask: TaskItem = {
            id: nextContraId,
            title: `Round ${nextRoundNum} (Contra): Counter-Critique & Pressure Test [Natural Prose, 100-180 words]`,
            lane: "contra",
            status: "blocked",
            assigned_to: null,
            depends_on_contracts: [nextProId],
            description: `Pressure-test Pro's round ${nextRoundNum} argument. Identify hidden assumptions or edge cases. Write in 1-2 natural paragraphs without headers.`
          };

          this.tasks.set(proTask.id, proTask);
          this.tasks.set(contraTask.id, contraTask);
          spawnedTasks.push(proTask, contraTask);
        }
      }
    }

    this.persistToDisk();
    return { success: true, task, unblockedTasks, spawnedTasks };
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
        try {
          this.validateGraphAcyclic();
        } catch (err: any) {
          console.warn(`[TaskBoardManager] Warning: Loaded task board contains cycle: ${err.message}`);
        }
      }
    } catch {
      // Ignore initial parse errors on empty or unformatted file
    }
  }
}
