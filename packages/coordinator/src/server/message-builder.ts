import type { MessageEnvelope } from "@nucleus/protocol";

export function buildMessage<T>(
  room_id: string,
  node_id: string,
  type: string,
  payload: T
): MessageEnvelope<T> {
  return {
    room_id,
    node_id,
    ts: Date.now(),
    type,
    payload,
    sig: ""  // Phase 2: replace with HMAC/Ed25519 signing
  };
}
