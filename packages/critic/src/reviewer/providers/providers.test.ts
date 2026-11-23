import { describe, it, expect, vi } from "vitest";
import { GeminiCriticProvider } from "./gemini-provider.js";
import { AnthropicCriticProvider } from "./anthropic-provider.js";
import { AutoLLMCriticProvider } from "./auto-provider.js";
import type { CritiqueContext } from "../ai-critic.js";

const mockContext: CritiqueContext = {
  taskId: "task-test-01",
  lane: "backend",
  spec: "Add /api/v1/health check endpoint",
  diff: "+ app.get('/health', (req, res) => res.json({ ok: true }));",
  deterministicChecksPassed: true,
  deterministicOutputs: ["Tests passed 5/5"]
};

describe("LLM Critic Providers", () => {
  describe("GeminiCriticProvider", () => {
    it("should return info finding when GEMINI_API_KEY is not set", async () => {
      const provider = new GeminiCriticProvider({ apiKey: "" });
      const findings = await provider.review(mockContext);

      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("info");
      expect(findings[0].message).toContain("GEMINI_API_KEY not configured");
    });

    it("should call Gemini endpoint and parse structured findings", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    {
                      severity: "warning",
                      file: "src/server.ts",
                      line: 12,
                      message: "Missing standard error envelope for /health",
                      suggested_fix: "Wrap response in status, data envelope"
                    }
                  ])
                }
              ]
            }
          }
        ]
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const provider = new GeminiCriticProvider({
        apiKey: "test-gemini-key",
        fetchFn: mockFetch as any
      });

      const findings = await provider.review(mockContext);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].file).toBe("src/server.ts");
      expect(findings[0].line).toBe(12);
      expect(findings[0].message).toContain("Missing standard error envelope");
    });

    it("should handle HTTP errors gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Quota exceeded or invalid key"
      });

      const provider = new GeminiCriticProvider({
        apiKey: "test-gemini-key",
        fetchFn: mockFetch as any
      });

      const findings = await provider.review(mockContext);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("Gemini API returned status 403");
    });
  });

  describe("AnthropicCriticProvider", () => {
    it("should return info finding when ANTHROPIC_API_KEY is not set", async () => {
      const provider = new AnthropicCriticProvider({ apiKey: "" });
      const findings = await provider.review(mockContext);

      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("info");
      expect(findings[0].message).toContain("ANTHROPIC_API_KEY not configured");
    });

    it("should call Anthropic endpoint with proper headers and parse findings", async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify([
              {
                severity: "critical",
                file: "src/auth.ts",
                line: 45,
                message: "Missing JWT expiration check",
                suggested_fix: "Validate exp claim against Date.now()"
              }
            ])
          }
        ]
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const provider = new AnthropicCriticProvider({
        apiKey: "test-anthropic-key",
        fetchFn: mockFetch as any
      });

      const findings = await provider.review(mockContext);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("critical");
      expect(findings[0].file).toBe("src/auth.ts");
    });
  });

  describe("AutoLLMCriticProvider", () => {
    it("should fallback to StaticRuleCriticProvider when no API keys are present in env", () => {
      const origGemini = process.env.GEMINI_API_KEY;
      const origAnthropic = process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const provider = new AutoLLMCriticProvider();
      expect(provider.name).toContain("static-rules");

      process.env.GEMINI_API_KEY = origGemini;
      process.env.ANTHROPIC_API_KEY = origAnthropic;
    });
  });
});
