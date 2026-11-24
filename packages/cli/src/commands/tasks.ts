import fs from "node:fs";
import path from "node:path";
import type { TaskItem } from "@nucleus/protocol";

export function listTasks(workspaceRoot: string, filterLane?: string, filterStatus?: string): void {
  const tasksFile = path.resolve(workspaceRoot, ".nucleus", "tasks.json");

  if (!fs.existsSync(tasksFile)) {
    console.log(`\nNo tasks found. Run inside a Nucleus workspace where tasks have been initialized.\n`);
    return;
  }

  try {
    const raw = fs.readFileSync(tasksFile, "utf8");
    const tasks: TaskItem[] = JSON.parse(raw);

    const filtered = tasks.filter((t) => {
      if (filterLane && t.lane !== filterLane) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      return true;
    });

    console.log(`\n📋 Nucleus Task Board (${filtered.length} tasks)`);
    console.log(`================================================================================`);
    console.log(
      `${"ID".padEnd(16)} | ${"LANE".padEnd(10)} | ${"STATUS".padEnd(14)} | ${"ASSIGNED".padEnd(12)} | TITLE`
    );
    console.log(`--------------------------------------------------------------------------------`);

    for (const t of filtered) {
      const assigned = t.assigned_to || "unassigned";
      console.log(
        `${t.id.padEnd(16)} | ${t.lane.padEnd(10)} | ${t.status.padEnd(14)} | ${assigned.padEnd(12)} | ${t.title}`
      );
    }
    console.log(`================================================================================\n`);
  } catch (err: any) {
    console.error(`Failed to read task board:`, err.message);
  }
}

export function claimTaskLocally(workspaceRoot: string, taskId: string, assignedTo: string, lane?: string): boolean {
  const tasksFile = path.resolve(workspaceRoot, ".nucleus", "tasks.json");

  if (!fs.existsSync(tasksFile)) {
    console.error(`Error: .nucleus/tasks.json not found in ${workspaceRoot}`);
    return false;
  }

  try {
    const raw = fs.readFileSync(tasksFile, "utf8");
    const tasks: TaskItem[] = JSON.parse(raw);

    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      console.error(`Error: Task "${taskId}" not found on board.`);
      return false;
    }

    if (lane && task.lane !== lane) {
      console.error(
        `Error: Lane mismatch. You are operating in lane "${lane}", but task "${taskId}" belongs to lane "${task.lane}".`
      );
      return false;
    }

    if (task.assigned_to && task.assigned_to !== assignedTo) {
      console.error(`Error: Task "${taskId}" is already assigned to "${task.assigned_to}".`);
      return false;
    }

    task.assigned_to = assignedTo;
    task.status = "active";

    fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2), "utf8");
    console.log(`\n✅ Successfully claimed task [${taskId}] for [${assignedTo}]!`);
    console.log(`Status updated to "active". Live daemon will sync changes to room.\n`);
    return true;
  } catch (err: any) {
    console.error(`Failed to update task:`, err.message);
    return false;
  }
}
