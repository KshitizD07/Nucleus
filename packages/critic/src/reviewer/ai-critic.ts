import type { CriticResult, CriticFindingItem } from "@nucleus/protocol";
import { SecretScanner } from "../scanner/secret-scanner.js";
import { MarkdownCritiqueFormatter } from "./formatter.js";

export interface CritiqueContext {
  taskId: string;
  lane: string;
  spec: string;
  diff: string;
  worktreePath?: string;
  deterministicChecksPassed: boolean;
  deterministicOutputs?: string[];
}

export interface LLMCriticProvider {
  name: string;
  review(context: CritiqueContext): Promise<CriticFindingItem[]>;
}

/**
 * Standard Rule-Based / Mock Critic Provider (zero API tokens, useful for local testing and CI)
 */
export class StaticRuleCriticProvider implements LLMCriticProvider {
  public readonly name = "static-rules";

  public async review(context: CritiqueContext): Promise<CriticFindingItem[]> {
    const findings: CriticFindingItem[] = [];

    // 1. Scan diff for hardcoded secrets
    const secretFindings = SecretScanner.scanFile("diff", context.diff);
    findings.push(...secretFindings);

    // 2. Check if diff is completely empty
    if (!context.diff.trim()) {
      findings.push({
        severity: "warning",
        file: "(workspace)",
        message: "Submitted diff is empty. No code changes detected.",
        suggested_fix: "Ensure your changes are staged or committed on your feature branch."
      });
    }

    // 3. Dialectic Brevity & Conciseness Guard (Pro / Contra lanes)
    if (context.lane === "pro" || context.lane === "contra") {
      const addedText = context.diff
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .map((line) => line.slice(1).trim())
        .join(" ");
      const words = addedText.split(/\s+/).filter(Boolean);
      if (words.length > 200) {
        findings.push({
          severity: "critical",
          file: "(dialectic-round)",
          message: `Dialectic brevity violation: Argument contains ${words.length} words (maximum allowed is 200 words).`,
          suggested_fix: "Deconstruct your argument into atomic premises. Keep this turn concise (under 200 words) so your counterpart can address a single focused claim."
        });
      }
    }

    return findings;
  }
}

/**
 * AI Critic Pipeline orchestrating Stage 1 (Deterministic) and Stage 2 (LLM Critic)
 */
export class AICriticPipeline {
  private provider: LLMCriticProvider;

  constructor(provider?: LLMCriticProvider) {
    this.provider = provider ?? new StaticRuleCriticProvider();
  }

  public setProvider(provider: LLMCriticProvider): void {
    this.provider = provider;
  }

  public async evaluate(context: CritiqueContext): Promise<{ result: CriticResult; markdown: string }> {
    const findings: CriticFindingItem[] = [];

    // Stage 1 deterministic check status
    let deterministicPassed = context.deterministicChecksPassed;

    // Run secret scanner on diff directly
    const secrets = SecretScanner.scanFile("diff", context.diff);
    if (secrets.length > 0) {
      findings.push(...secrets);
      deterministicPassed = false;
    }

    // Stage 2 LLM Critic pass
    try {
      const llmFindings = await this.provider.review(context);
      findings.push(...llmFindings);
    } catch (err: any) {
      findings.push({
        severity: "warning",
        file: "(critic-engine)",
        message: `AI Critic evaluation encountered error: ${err.message}`
      });
    }

    const hasCritical = findings.some((f) => f.severity === "critical");
    const verdict: "approved" | "changes_requested" = deterministicPassed && !hasCritical ? "approved" : "changes_requested";

    const result: CriticResult = {
      task_id: context.taskId,
      lane: context.lane,
      verdict,
      deterministic_checks_passed: deterministicPassed,
      findings,
      critique_file_path: `.nucleus/critiques/${context.taskId}.md`
    };

    const markdown = MarkdownCritiqueFormatter.format(result);

    return { result, markdown };
  }
}
