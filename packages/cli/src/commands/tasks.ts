import fs from "node:fs";
import path from "node:path";
import type { TaskItem } from "@nucleus/protocol";

export function listTasks(
  workspaceRoot: string,
  filterLane?: string,
  filterStatus?: string,
  showArchived: boolean = false
): void {
  const fileName = showArchived ? "tasks_archive.json" : "tasks.json";
  const tasksFile = path.resolve(workspaceRoot, ".nucleus", fileName);

  if (!fs.existsSync(tasksFile)) {
    if (showArchived) {
      console.log(`\nNo archived tasks found in .nucleus/tasks_archive.json.\n`);
    } else {
      console.log(`\nNo tasks found. Run inside a Nucleus workspace where tasks have been initialized.\n`);
    }
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

    const header = showArchived ? `📦 Nucleus Archived Tasks` : `📋 Nucleus Task Board`;
    console.log(`\n${header} (${filtered.length} tasks)`);
    console.log(`================================================================================`);
    console.log(
      `${"ID".padEnd(16)} | ${"LANE".padEnd(10)} | ${"STATUS".padEnd(14)} | ${"ASSIGNED".padEnd(12)} | TITLE`
    );
    console.log(`--------------------------------------------------------------------------------`);

    for (const t of filtered) {
      const assigned = t.assigned_to || "unassigned";
      let meta = "";
      if (t.spec_file) meta += ` (spec: ${t.spec_file})`;
      if (t.spec_url) meta += ` (url: ${t.spec_url})`;
      console.log(
        `${t.id.padEnd(16)} | ${t.lane.padEnd(10)} | ${t.status.padEnd(14)} | ${assigned.padEnd(12)} | ${t.title}${meta}`
      );
    }
    console.log(`================================================================================`);
    if (!showArchived) {
      console.log(`(Tip: Run 'nucleus tasks --clean' to archive approved tasks, or '--archived' to view past tasks)\n`);
    } else {
      console.log(`(Archived tasks stored in .nucleus/tasks_archive.json)\n`);
    }
  } catch (err: any) {
    console.error(`Failed to read task board:`, err.message);
  }
}

export function archiveCompletedTasksLocally(
  workspaceRoot: string
): { archivedCount: number; remainingCount: number } {
  const tasksFile = path.resolve(workspaceRoot, ".nucleus", "tasks.json");
  const archiveFile = path.resolve(workspaceRoot, ".nucleus", "tasks_archive.json");

  if (!fs.existsSync(tasksFile)) {
    console.log(`\nNo tasks found to archive.\n`);
    return { archivedCount: 0, remainingCount: 0 };
  }

  try {
    const raw = fs.readFileSync(tasksFile, "utf8");
    const tasks: TaskItem[] = JSON.parse(raw);

    const activeTasks = tasks.filter((t) => t.status !== "approved");
    const toArchive = tasks.filter((t) => t.status === "approved");

    if (toArchive.length === 0) {
      console.log(`\nTask board is already tidy. No "approved" tasks pending archival (${activeTasks.length} active tasks).\n`);
      return { archivedCount: 0, remainingCount: activeTasks.length };
    }

    let existingArchive: TaskItem[] = [];
    if (fs.existsSync(archiveFile)) {
      try {
        existingArchive = JSON.parse(fs.readFileSync(archiveFile, "utf8"));
      } catch {}
    }

    const combinedArchive = [...existingArchive, ...toArchive];
    fs.writeFileSync(archiveFile, JSON.stringify(combinedArchive, null, 2), "utf8");
    fs.writeFileSync(tasksFile, JSON.stringify(activeTasks, null, 2), "utf8");

    console.log(`\n📦 Successfully cleaned task board!`);
    console.log(`Archived ${toArchive.length} completed task(s) to .nucleus/tasks_archive.json:`);
    for (const t of toArchive) {
      console.log(`  - [${t.id}] ${t.title} (${t.lane})`);
    }
    console.log(`Active task board now has ${activeTasks.length} open task(s).\n`);

    return { archivedCount: toArchive.length, remainingCount: activeTasks.length };
  } catch (err: any) {
    console.error(`Failed to archive tasks:`, err.message);
    return { archivedCount: 0, remainingCount: 0 };
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
        `\n⚠️ Lane mismatch: Task [${taskId}] belongs to '${task.lane}' lane, but your active lane is '${lane}'.`
      );
      const availableUserLane = tasks
        .filter((t) => t.lane === lane && (!t.assigned_to || t.status === "unassigned"))
        .map((t) => t.id);
      if (availableUserLane.length > 0) {
        console.error(`Available tasks in '${lane}' lane: [${availableUserLane.join(", ")}]\n`);
      } else {
        console.error(`No unassigned tasks currently available in '${lane}' lane.\n`);
      }
      return false;
    }

    if (task.assigned_to && task.assigned_to !== assignedTo) {
      console.error(`\n⚠️ Task [${taskId}] was already claimed by ${task.assigned_to}.`);
      const availableSameLane = tasks
        .filter((t) => t.lane === task.lane && (!t.assigned_to || t.status === "unassigned") && t.id !== taskId)
        .map((t) => t.id);
      if (availableSameLane.length > 0) {
        console.error(`Available tasks in '${task.lane}' lane: [${availableSameLane.join(", ")}]\n`);
      } else {
        console.error(`No other unassigned tasks currently available in '${task.lane}' lane.\n`);
      }
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
