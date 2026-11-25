import crypto from "node:crypto";
import { z } from "zod";

export const MessageEnvelopeSchema = z.object({
  room_id: z.string().min(1),
  node_id: z.string().min(1),
  ts: z.number().int().positive(),
  type: z.string().min(1),
  payload: z.unknown(),
  sig: z.string().default("")
});

export type MessageEnvelope<T = unknown> = Omit<z.infer<typeof MessageEnvelopeSchema>, "payload"> & {
  payload: T;
};

/**
 * Computes an HMAC-SHA256 signature over an envelope's fields.
 */
export function computeEnvelopeSignature(
  envelope: Omit<MessageEnvelope, "sig">,
  secretKey: string
): string {
  const hmac = crypto.createHmac("sha256", secretKey);
  const data = `${envelope.room_id}:${envelope.node_id}:${envelope.ts}:${envelope.type}:${JSON.stringify(envelope.payload)}`;
  return hmac.update(data).digest("hex");
}

/**
 * Signs an envelope with the given secret key.
 */
export function signEnvelope<T>(
  envelope: Omit<MessageEnvelope<T>, "sig">,
  secretKey: string
): MessageEnvelope<T> {
  const sig = computeEnvelopeSignature(envelope as any, secretKey);
  return { ...envelope, sig };
}

/**
 * Validates the HMAC-SHA256 signature of an envelope.
 */
export function verifyEnvelopeSignature(
  envelope: MessageEnvelope,
  secretKey: string
): boolean {
  if (!envelope.sig) return false;
  const expected = computeEnvelopeSignature(envelope, secretKey);
  try {
    return crypto.timingSafeEqual(Buffer.from(envelope.sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
