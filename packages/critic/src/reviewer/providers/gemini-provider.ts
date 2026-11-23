import type { CriticFindingItem } from "@nucleus/protocol";
import type { CritiqueContext, LLMCriticProvider } from "../ai-critic.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

export class GeminiCriticProvider implements LLMCriticProvider {
  public readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options.model || "gemini-2.0-flash";
    this.fetchFn = options.fetchFn || fetch;
    this.name = `gemini (${this.model})`;
  }

  public async review(context: CritiqueContext): Promise<CriticFindingItem[]> {
    if (!this.apiKey) {
      return [
        {
          severity: "info",
          file: "(ai-critic)",
          message: "GEMINI_API_KEY not configured. Skipping generative architectural pass; static checks applied."
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [
        {
          parts: [{ text: systemPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    };

    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      return [
        {
          severity: "warning",
          file: "(ai-critic)",
          message: `Gemini API returned status ${res.status}: ${errText}`
        }
      ];
    }

    const data = await res.json() as any;
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
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
