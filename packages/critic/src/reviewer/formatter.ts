import type { CriticResult } from "@nucleus/protocol";

export class MarkdownCritiqueFormatter {
  public static format(result: CriticResult): string {
    const lines: string[] = [
      `# Critique Review: Task [${result.task_id}] (Lane: ${result.lane})`,
      ``,
      `**Verdict:** ${result.verdict.toUpperCase()}`,
      `**Deterministic Checks:** ${result.deterministic_checks_passed ? "PASSED" : "FAILED"}`,
      ``,
      `## Findings & Required Actions`,
      ``
    ];

    if (result.findings.length === 0) {
      lines.push(`No issues detected. Work meets all contract and spec requirements.`);
    } else {
      for (const finding of result.findings) {
        lines.push(`### [${finding.severity.toUpperCase()}] ${finding.file}${finding.line ? `:${finding.line}` : ""}`);
        lines.push(`- **Issue:** ${finding.message}`);
        if (finding.suggested_fix) {
          lines.push(`- **Suggested Fix:** ${finding.suggested_fix}`);
        }
        lines.push(``);
      }
    }

    return lines.join("\n");
  }
}
