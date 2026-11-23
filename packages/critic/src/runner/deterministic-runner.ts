import { execSync } from "node:child_process";

export interface CheckCommand {
  name: string;
  command: string;
  timeoutMs?: number;
}

export interface CheckRunResult {
  passed: boolean;
  name: string;
  output: string;
  durationMs: number;
  error?: string;
}

export class DeterministicRunner {
  public static runChecks(worktreePath: string, checks: CheckCommand[]): { passed: boolean; results: CheckRunResult[] } {
    const results: CheckRunResult[] = [];
    let allPassed = true;

    for (const check of checks) {
      const start = performance.now();
      try {
        const output = execSync(check.command, {
          cwd: worktreePath,
          stdio: "pipe",
          timeout: check.timeoutMs ?? 30_000,
          encoding: "utf8"
        });

        const durationMs = Math.round(performance.now() - start);
        results.push({
          name: check.name,
          passed: true,
          output: output.slice(0, 5000), // Cap output length
          durationMs
        });
      } catch (err: any) {
        allPassed = false;
        const durationMs = Math.round(performance.now() - start);
        const errorOutput = (err.stdout?.toString() || "") + "\n" + (err.stderr?.toString() || err.message);

        results.push({
          name: check.name,
          passed: false,
          output: errorOutput.slice(0, 5000),
          durationMs,
          error: `Check '${check.name}' failed with exit code ${err.status ?? "unknown"}`
        });
      }
    }

    return { passed: allPassed, results };
  }
}
