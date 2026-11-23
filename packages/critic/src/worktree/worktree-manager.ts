import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface WorktreeCreateOptions {
  repoRoot: string;
  worktreesDir: string;
  branch: string;
  taskId: string;
}

export class WorktreeManager {
  private readonly repoRoot: string;
  private readonly worktreesDir: string;
  private readonly activeWorktrees: Map<string, string> = new Map();

  constructor(repoRoot: string, worktreesDir: string) {
    this.repoRoot = path.resolve(repoRoot);
    this.worktreesDir = path.resolve(worktreesDir);
    fs.mkdirSync(this.worktreesDir, { recursive: true });
  }

  /**
   * Create an isolated worktree checked out to the specified branch for evaluation
   */
  public createWorktree(taskId: string, branch: string): { success: boolean; worktreePath: string; error?: string } {
    const worktreePath = path.join(this.worktreesDir, `wt-${taskId}`);

    // If an existing worktree was left over from a previous crash, remove it first
    this.removeWorktree(taskId);

    try {
      execSync(`git worktree add --detach "${worktreePath}" "${branch}"`, {
        cwd: this.repoRoot,
        stdio: "pipe",
        timeout: 15_000
      });

      this.activeWorktrees.set(taskId, worktreePath);
      return { success: true, worktreePath };
    } catch (err: any) {
      return {
        success: false,
        worktreePath: "",
        error: err.stderr?.toString() || err.message
      };
    }
  }

  /**
   * Safely clean up and remove a disposable worktree
   */
  public removeWorktree(taskId: string): void {
    const worktreePath = this.activeWorktrees.get(taskId) || path.join(this.worktreesDir, `wt-${taskId}`);

    try {
      execSync(`git worktree remove --force "${worktreePath}"`, {
        cwd: this.repoRoot,
        stdio: "pipe",
        timeout: 10_000
      });
    } catch {
      // If git worktree command failed (e.g. dir manually modified), fallback to prune
      try {
        if (fs.existsSync(worktreePath)) {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
        execSync(`git worktree prune`, {
          cwd: this.repoRoot,
          stdio: "pipe"
        });
      } catch {
        // Suppress prune failures
      }
    } finally {
      this.activeWorktrees.delete(taskId);
    }
  }

  public getWorktreePath(taskId: string): string | undefined {
    return this.activeWorktrees.get(taskId);
  }
}
