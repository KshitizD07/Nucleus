import type { CriticFindingItem } from "@nucleus/protocol";
import type { CritiqueContext, LLMCriticProvider } from "../ai-critic.js";
import { StaticRuleCriticProvider } from "../ai-critic.js";
import { GeminiCriticProvider } from "./gemini-provider.js";
import { AnthropicCriticProvider } from "./anthropic-provider.js";

export class AutoLLMCriticProvider implements LLMCriticProvider {
  public readonly name: string;
  private readonly delegate: LLMCriticProvider;

  constructor() {
    if (process.env.GEMINI_API_KEY) {
      this.delegate = new GeminiCriticProvider();
    } else if (process.env.ANTHROPIC_API_KEY) {
      this.delegate = new AnthropicCriticProvider();
    } else {
      this.delegate = new StaticRuleCriticProvider();
    }
    this.name = `auto -> ${this.delegate.name}`;
  }

  public async review(context: CritiqueContext): Promise<CriticFindingItem[]> {
    return this.delegate.review(context);
  }

  public getDelegate(): LLMCriticProvider {
    return this.delegate;
  }
}
