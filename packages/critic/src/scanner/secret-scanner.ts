import fs from "node:fs";
import path from "node:path";
import type { CriticFindingItem } from "@nucleus/protocol";

export interface SecretPattern {
  name: string;
  regex: RegExp;
}

export const DEFAULT_SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "Private Key Header",
    regex: /-----BEGIN (RSA|EC|DSA|OPENSSH)?\s?PRIVATE KEY-----/i
  },
  {
    name: "AWS Access Key ID",
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    name: "Stripe Secret Key",
    regex: /\b(sk_live_[0-9a-zA-Z]{24,})\b/
  },
  {
    name: "Generic Secret / Password Assignment",
    regex: /(api_key|apikey|secret|password|passwd|private_key)\s*[:=]\s*["'][a-zA-Z0-9_\-.~!@#$%^&*+=]{8,}["']/i
  }
];

export class SecretScanner {
  public static scanFile(filePath: string, content: string, patterns = DEFAULT_SECRET_PATTERNS): CriticFindingItem[] {
    const findings: CriticFindingItem[] = [];
    const lines = content.split("\n");

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          findings.push({
            severity: "critical",
            file: filePath,
            line: lineNum + 1,
            message: `Potential credential/secret leak detected: ${pattern.name}`,
            suggested_fix: "Remove hardcoded secret and reference an environment variable instead."
          });
          break; // Avoid duplicate flags for the same line
        }
      }
    }

    return findings;
  }

  public static scanDirectory(dirPath: string, patterns = DEFAULT_SECRET_PATTERNS, ignoreList = ["node_modules", ".git", "dist", ".nucleus"]): CriticFindingItem[] {
    const findings: CriticFindingItem[] = [];

    const walk = (current: string) => {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (ignoreList.includes(entry.name)) continue;

        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            const relative = path.relative(dirPath, fullPath).replace(/\\/g, "/");
            findings.push(...this.scanFile(relative, content, patterns));
          } catch {
            // Ignore non-UTF8/binary files
          }
        }
      }
    };

    if (fs.existsSync(dirPath)) {
      walk(dirPath);
    }

    return findings;
  }
}
