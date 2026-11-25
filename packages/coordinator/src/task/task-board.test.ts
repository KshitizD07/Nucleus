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

  it("should separate immutable assigned_node_id from mutable display_name", () => {
    const board = new TaskBoardManager(tempDir);
    board.addTask({
      id: "task-identity",
      title: "Identity Task",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    // 1. Rohan claims with display name
    const claimRes = board.claimTask("task-identity", "rohan-laptop-01", undefined, "backend", "Rohan");
    expect(claimRes.success).toBe(true);

    const task = board.getTask("task-identity");
    expect(task?.assigned_node_id).toBe("rohan-laptop-01");
    expect(task?.assigned_name).toBe("Rohan");
    expect(task?.assigned_to).toContain("Rohan (rohan-laptop-01)");

    // 2. Impersonator with matching display name "Rohan" but different node_id cannot steal claim
    const spoofClaim = board.claimTask("task-identity", "impersonator-node", undefined, "backend", "Rohan");
    expect(spoofClaim.success).toBe(false);
    expect(spoofClaim.reason).toContain("already claimed by Rohan");

    // 3. Same node claiming again succeeds
    const sameClaim = board.claimTask("task-identity", "rohan-laptop-01", undefined, "backend", "Rohan");
    expect(sameClaim.success).toBe(true);
  });

  it("should enforce strict topological dependency ordering and reject non-existent task dependencies", () => {
    const board = new TaskBoardManager(tempDir);

    // 1. Adding task depending on non-existent task must throw
    expect(() => {
      board.addTask({
        id: "task-child",
        title: "Child Task",
        lane: "backend",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["ghost-task-404"]
      });
    }).toThrow(/Referenced task 'ghost-task-404' does not exist in task board/);

    // 2. Adding parent task first succeeds
    board.addTask({
      id: "task-parent",
      title: "Parent Task",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    // 3. Adding child task after parent exists succeeds
    expect(() => {
      board.addTask({
        id: "task-child",
        title: "Child Task",
        lane: "backend",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["task-parent"]
      });
    }).not.toThrow();

    expect(board.getTask("task-child")?.status).toBe("blocked");
  });

  it("should detect and reject dependency cycles (self, 2-node, and transitive cycles)", () => {
    const board = new TaskBoardManager(tempDir);

    // 1. Self-dependency rejection
    expect(() => {
      board.addTask({
        id: "task-self",
        title: "Self Dependent Task",
        lane: "backend",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["task-self"]
      });
    }).toThrow(/Task 'task-self' cannot depend on itself/);

    // 2. Setup A and B
    board.addTask({
      id: "task-A",
      title: "Task A",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    board.addTask({
      id: "task-B",
      title: "Task B",
      lane: "backend",
      status: "blocked",
      assigned_to: null,
      depends_on_contracts: ["task-A"]
    });

    // 3. Re-adding/updating Task A to depend on Task B forms a 2-node cycle (A -> B -> A)
    expect(() => {
      board.addTask({
        id: "task-A",
        title: "Task A updated",
        lane: "backend",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["task-B"]
      });
    }).toThrow(/Dependency cycle detected: task-A -> task-B -> task-A/);

    // 4. Setup Transitive Cycle (A -> B -> C -> A)
    board.addTask({
      id: "task-C",
      title: "Task C",
      lane: "backend",
      status: "blocked",
      assigned_to: null,
      depends_on_contracts: ["task-B"]
    });

    expect(() => {
      board.addTask({
        id: "task-A",
        title: "Task A with transitive cycle",
        lane: "backend",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["task-C"]
      });
    }).toThrow(/Dependency cycle detected: task-A -> task-C -> task-B -> task-A/);
  });

  it("should allow valid DAG structures such as diamond dependencies", () => {
    const board = new TaskBoardManager(tempDir);

    // Diamond DAG:
    //      A (root)
    //     / \
    //    B   C
    //     \ /
    //      D (depends on B and C)
    board.addTask({
      id: "node-A",
      title: "Root A",
      lane: "backend",
      status: "unassigned",
      assigned_to: null,
      depends_on_contracts: []
    });

    board.addTask({
      id: "node-B",
      title: "Branch B",
      lane: "backend",
      status: "blocked",
      assigned_to: null,
      depends_on_contracts: ["node-A"]
    });

    board.addTask({
      id: "node-C",
      title: "Branch C",
      lane: "backend",
      status: "blocked",
      assigned_to: null,
      depends_on_contracts: ["node-A"]
    });

    expect(() => {
      board.addTask({
        id: "node-D",
        title: "Join D",
        lane: "backend",
        status: "blocked",
        assigned_to: null,
        depends_on_contracts: ["node-B", "node-C"]
      });
    }).not.toThrow();

    expect(board.getTask("node-D")?.status).toBe("blocked");
  });

  it("should strictly validate contract dependencies and auto-unblock only when satisfied", () => {
    const mockContracts: Record<string, { filePath: string; content: string; version: number }> = {};
    const mockStore = {
      get: (p: string) => mockContracts[p]
    };

    const board = new TaskBoardManager(tempDir, mockStore);

    // 1. Task depending on non-existent contract remains blocked
    board.addTask({
      id: "task-contract-dep",
      title: "Contract Dep Task",
      lane: "backend",
      status: "blocked",
      assigned_to: null,
      depends_on_contracts: ["CONTRACT/specs.md@2"]
    });

    // Unblocking check: contract doesn't exist yet -> remains blocked
    let unblocked = board.evaluateUnblockedTasks();
    expect(unblocked.length).toBe(0);
    expect(board.getTask("task-contract-dep")?.status).toBe("blocked");

    // 2. Publish contract at version 1 (insufficient: task needs @2)
    mockContracts["specs.md"] = {
      filePath: "specs.md",
      content: "# Specs v1",
      version: 1
    };
    unblocked = board.evaluateUnblockedTasks();
    expect(unblocked.length).toBe(0);
    expect(board.getTask("task-contract-dep")?.status).toBe("blocked");

    // 3. Publish contract at version 2 -> task auto-unblocks to unassigned!
    mockContracts["specs.md"] = {
      filePath: "specs.md",
      content: "# Specs v2",
      version: 2
    };
    unblocked = board.evaluateUnblockedTasks();
    expect(unblocked.length).toBe(1);
    expect(unblocked[0].id).toBe("task-contract-dep");
    expect(board.getTask("task-contract-dep")?.status).toBe("unassigned");
  });
});
