import { describe, it, expect } from "vitest";
import { SecretScanner } from "./secret-scanner.js";

describe("SecretScanner (Deterministic Gate Security Rule)", () => {
  it("should flag AWS access keys as critical findings", () => {
    const code = `
      const config = {
        awsKey: "AKIAIOSFODNN7EXAMPLE",
        region: "us-east-1"
      };
    `;

    const findings = SecretScanner.scanFile("src/aws.ts", code);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("AWS Access Key ID");
    expect(findings[0].line).toBe(3);
  });

  it("should flag Stripe live secret keys", () => {
    // Construct mock key dynamically to prevent GitHub Push Protection scanner false positives
    const mockStripeKey = ["sk", "live", "mockkeytest1234567890abcdef"].join("_");
    const code = `const stripe = new Stripe("${mockStripeKey}");`;
    const findings = SecretScanner.scanFile("src/payments.ts", code);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("Stripe Secret Key");
  });

  it("should pass clean code with zero findings", () => {
    const code = `
      export const apiKey = process.env.STRIPE_SECRET_KEY;
      export const port = 3000;
    `;
    const findings = SecretScanner.scanFile("src/config.ts", code);
    expect(findings.length).toBe(0);
  });
});
