import type { CriticFindingItem } from "@nucleus/protocol";
import type { CritiqueContext, LLMCriticProvider } from "../ai-critic.js";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

export class AnthropicCriticProvider implements LLMCriticProvider {
  public readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.model = options.model || "claude-3-5-sonnet-20241022";
    this.fetchFn = options.fetchFn || fetch;
    this.name = `anthropic (${this.model})`;
  }

  public async review(context: CritiqueContext): Promise<CriticFindingItem[]> {
    if (!this.apiKey) {
      return [
        {
          severity: "info",
          file: "(ai-critic)",
          message: "ANTHROPIC_API_KEY not configured. Skipping generative architectural pass; static checks applied."
        }
      ];
    }

    const systemPrompt = `You are the Nucleus AI Architectural Gate Critic.
Review the submitted code diff for Task "${context.taskId}" in Lane "${context.lane}".

Specification:
${context.spec}

Deterministic Test/Build Status:
Passed: ${context.deterministicChecksPassed}
Outputs: ${context.deterministicOutputs?.join("\n") || "(None)"}

Diff to Evaluate:
${context.diff}

Return a valid JSON array of architectural findings. Each finding object MUST follow this schema:
[
  {
    "severity": "info" | "warning" | "critical",
    "file": "<relative file path>",
    "line": <number, optional>,
    "message": "<clear explanation of architectural divergence, contract violation, or logic flaw>",
    "suggested_fix": "<actionable recommendation, optional>"
  }
]
If the code correctly implements the specification without architectural flaws, return an empty array [].
Output ONLY the raw JSON array without markdown code blocks.`;

    const url = "https://api.anthropic.com/v1/messages";
    const payload = {
      model: this.model,
      max_tokens: 2048,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: systemPrompt
        }
      ]
    };

    const res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      return [
        {
          severity: "warning",
          file: "(ai-critic)",
          message: `Anthropic API returned status ${res.status}: ${errText}`
        }
      ];
    }

    const data = await res.json() as any;
    const rawText = data?.content?.[0]?.text || "[]";
    return this.parseFindings(rawText);
  }

  private parseFindings(text: string): CriticFindingItem[] {
    try {
      const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: any): CriticFindingItem => ({
        severity: ["info", "warning", "critical"].includes(item.severity) ? item.severity : "warning",
        file: String(item.file || "(unknown)"),
        line: typeof item.line === "number" ? item.line : undefined,
        message: String(item.message || "Unspecified finding"),
        suggested_fix: item.suggested_fix ? String(item.suggested_fix) : undefined
      }));
    } catch {
      return [
        {
          severity: "warning",
          file: "(ai-critic)",
          message: `Failed to parse LLM critic response into JSON findings: ${text.slice(0, 120)}`
        }
      ];
    }
  }
}
