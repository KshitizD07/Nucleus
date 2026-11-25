import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TaskBoardManager } from "./task-board.js";
import { TaskBoardReplica } from "@nucleus/daemon";

describe("TaskBoardManager Revision Tracking & Optimistic Concurrency", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-board-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should initialize task revision to 1 and increment monotonically on state changes", () => {
    const board = new TaskBoardManager(tempDir);
    board.addTask({
      id: "task-1",
      title: "Task 1",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    const initial = board.getTask("task-1");
    expect(initial?.revision).toBe(1);

    // Claim increments revision from 1 -> 2
    const claimed = board.claimTask("task-1", "node-1", undefined, "backend", "Dev 1");
    expect(claimed.success).toBe(true);
    expect(claimed.task?.revision).toBe(2);

    // Status update increments revision from 2 -> 3
    const updated = board.updateStatus("task-1", "in_review", "feature-branch");
    expect(updated.success).toBe(true);
    expect(updated.task?.revision).toBe(3);
  });

  it("should enforce optimistic concurrency with expectedRevision", () => {
    const board = new TaskBoardManager(tempDir);
    board.addTask({
      id: "task-concurrency",
      title: "Concurrent Task",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    // Task is at revision 1
    // 1. Valid claim matching revision 1 succeeds
    const claimRes = board.claimTask("task-concurrency", "node-1", undefined, "backend", "Alice", 1);
    expect(claimRes.success).toBe(true);
    expect(claimRes.task?.revision).toBe(2);

    // 2. Stale update expecting revision 1 should be REJECTED (since task is now at revision 2)
    const staleUpdate = board.updateStatus("task-concurrency", "in_review", undefined, 1);
    expect(staleUpdate.success).toBe(false);
    expect(staleUpdate.reason).toContain("Conflict: Stale task revision 1 (current: 2)");

    // 3. Update matching current revision 2 succeeds
    const validUpdate = board.updateStatus("task-concurrency", "in_review", undefined, 2);
    expect(validUpdate.success).toBe(true);
    expect(validUpdate.task?.revision).toBe(3);
  });

  it("should reject stale task updates in TaskBoardReplica", () => {
    const replicaDir = path.join(tempDir, "replica_ws");
    fs.mkdirSync(replicaDir, { recursive: true });
    const replica = new TaskBoardReplica(replicaDir);

    // Apply revision 2
    const firstApply = replica.applyUpdate({
      id: "task-replica-test",
      title: "Test Task",
      lane: "frontend",
      status: "active",
      revision: 2,
      assigned_to: "dev-a",
      depends_on_contracts: []
    });
    expect(firstApply).toBe(true);
    expect(replica.getTask("task-replica-test")?.status).toBe("active");

    // Attempt to apply an out-of-order older revision 1
    const staleApply = replica.applyUpdate({
      id: "task-replica-test",
      title: "Test Task",
      lane: "frontend",
      status: "unassigned",
      revision: 1,
      assigned_to: null,
      depends_on_contracts: []
    });
    expect(staleApply).toBe(false);
    // State remains at revision 2!
    expect(replica.getTask("task-replica-test")?.status).toBe("active");
  });

  it("should enforce legal state transitions and reject invalid state jumps", () => {
    const board = new TaskBoardManager(tempDir);
    board.addTask({
      id: "task-fsm",
      title: "State Machine Task",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    // 1. Direct jump unassigned -> approved is ILLEGAL
    const invalidJump = board.updateStatus("task-fsm", "approved");
    expect(invalidJump.success).toBe(false);
    expect(invalidJump.reason).toContain("Illegal task transition: Cannot move task 'task-fsm' from 'unassigned' to 'approved'");

    // 2. Legal progression: unassigned -> active (via claim)
    const claimed = board.claimTask("task-fsm", "node-1", undefined, "backend", "Dev");
    expect(claimed.success).toBe(true);

    // 3. active -> in_review is LEGAL
    const review = board.updateStatus("task-fsm", "in_review");
    expect(review.success).toBe(true);

    // 4. in_review -> changes_requested is LEGAL
    const changesReq = board.updateStatus("task-fsm", "changes_requested");
    expect(changesReq.success).toBe(true);

    // 5. changes_requested -> active is LEGAL (resume work)
    const resume = board.updateStatus("task-fsm", "active");
    expect(resume.success).toBe(true);

    // 6. active -> in_review -> approved is LEGAL
    board.updateStatus("task-fsm", "in_review");
    const approved = board.updateStatus("task-fsm", "approved");
    expect(approved.success).toBe(true);

    // 7. approved is TERMINAL: approved -> active or in_review is ILLEGAL
    const tryReopen = board.updateStatus("task-fsm", "active");
    expect(tryReopen.success).toBe(false);
    expect(tryReopen.reason).toContain("Illegal task transition: Cannot move task 'task-fsm' from 'approved' to 'active'");

    // 8. Cannot claim an approved task
    const claimApproved = board.claimTask("task-fsm", "node-2");
    expect(claimApproved.success).toBe(false);
    expect(claimApproved.reason).toContain("already approved");

    // 9. Administrative force override is honored
    const forced = board.updateStatus("task-fsm", "unassigned", undefined, undefined, true);
    expect(forced.success).toBe(true);
    expect(board.getTask("task-fsm")?.status).toBe("unassigned");
  });
});
