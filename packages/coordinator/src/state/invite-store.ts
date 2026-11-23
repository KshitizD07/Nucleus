import crypto from "node:crypto";

export interface InviteToken {
  token: string;
  lane: string;
  expires_at: number;
  used: boolean;
}

export class InviteStore {
  private readonly tokens: Map<string, InviteToken> = new Map();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 15 * 60 * 1000) { // 15 min default
    this.ttlMs = ttlMs;
  }

  public issue(lane: string): string {
    const token = crypto.randomBytes(24).toString("hex");
    this.tokens.set(token, {
      token,
      lane,
      expires_at: Date.now() + this.ttlMs,
      used: false
    });
    return token;
  }

  public consume(token: string): InviteToken | null {
    const invite = this.tokens.get(token);
    if (!invite) return null;
    if (invite.used) return null;
    if (Date.now() > invite.expires_at) {
      this.tokens.delete(token);
      return null;
    }
    invite.used = true;
    return invite;
  }

  public revoke(token: string): void {
    this.tokens.delete(token);
  }
}
