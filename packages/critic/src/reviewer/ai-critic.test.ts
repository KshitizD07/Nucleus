import { describe, it, expect } from "vitest";
import { AICriticPipeline, type LLMCriticProvider, type CritiqueContext } from "./ai-critic.js";
import type { CriticFindingItem } from "@nucleus/protocol";

describe("AICriticPipeline (Two-Stage Gate Evaluation)", () => {
  it("should approve a clean diff with passing deterministic checks", async () => {
    const pipeline = new AICriticPipeline();

    const { result, markdown } = await pipeline.evaluate({
      taskId: "task-clean-01",
      lane: "backend",
      spec: "Add health check endpoint",
      diff: "+ export const health = () => ({ status: 'ok' });",
      deterministicChecksPassed: true
    });

    expect(result.verdict).toBe("approved");
    expect(result.deterministic_checks_passed).toBe(true);
    expect(markdown).toContain("**Verdict:** APPROVED");
  });

  it("should reject a diff containing a hardcoded secret even if deterministic checks passed", async () => {
    const pipeline = new AICriticPipeline();

    // Construct mock key dynamically to prevent GitHub Push Protection false positives
    const mockKey = ["sk", "live", "999999999999999999999999"].join("_");
    const { result, markdown } = await pipeline.evaluate({
      taskId: "task-secret-02",
      lane: "backend",
      spec: "Add stripe checkout",
      diff: `+ const key = "${mockKey}";`,
      deterministicChecksPassed: true
    });

    expect(result.verdict).toBe("changes_requested");
    expect(result.deterministic_checks_passed).toBe(false);
    expect(markdown).toContain("Stripe Secret Key");
    expect(markdown).toContain("**Verdict:** CHANGES_REQUESTED");
  });

  it("should incorporate custom LLM provider findings", async () => {
    const customLLM: LLMCriticProvider = {
      name: "custom-gemini-critic",
      review: async (_ctx: CritiqueContext): Promise<CriticFindingItem[]> => {
        return [
          {
            severity: "critical",
            file: "src/auth.ts",
            line: 42,
            message: "Missing rate-limiter on password reset endpoint",
            suggested_fix: "Wrap route in express-rate-limit middleware"
          }
        ];
      }
    };

    const pipeline = new AICriticPipeline(customLLM);

    const { result, markdown } = await pipeline.evaluate({
      taskId: "task-rate-limit",
      lane: "backend",
      spec: "Password reset route",
      diff: "+ router.post('/reset-password', handler);",
      deterministicChecksPassed: true
    });

    expect(result.verdict).toBe("changes_requested");
    expect(markdown).toContain("Missing rate-limiter");
    expect(markdown).toContain("express-rate-limit");
  });

  it("DIALECTIC BREVITY GUARD: rejects arguments exceeding 200 words in pro/contra lane", async () => {
    const pipeline = new AICriticPipeline();

    // Generate a rambling 250-word argument
    const longArgument = Array(250).fill("premise").join(" ");
    const { result, markdown } = await pipeline.evaluate({
      taskId: "round-01-pro",
      lane: "pro",
      spec: "Opening Thesis",
      diff: `+ ${longArgument}`,
      deterministicChecksPassed: true
    });

    expect(result.verdict).toBe("changes_requested");
    expect(markdown).toContain("Dialectic brevity violation");
    expect(markdown).toContain("maximum allowed is 200 words");

    // Concise argument under 200 words passes
    const conciseArgument = "+ Premise: Functional computation requires memory. Argument: State changes necessitate bounded side-effects. Conclusion: Pure functions alone cannot model stateful agents.";
    const passed = await pipeline.evaluate({
      taskId: "round-01-pro",
      lane: "pro",
      spec: "Opening Thesis",
      diff: conciseArgument,
      deterministicChecksPassed: true
    });

    expect(passed.result.verdict).toBe("approved");
  });
});
