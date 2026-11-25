import type { MessageEnvelope } from "@nucleus/protocol";
import { signEnvelope } from "@nucleus/protocol";

export function buildMessage<T>(
  room_id: string,
  node_id: string,
  type: string,
  payload: T,
  secretKey?: string
): MessageEnvelope<T> {
  const msg: Omit<MessageEnvelope<T>, "sig"> = {
    room_id,
    node_id,
    ts: Date.now(),
    type,
    payload
  };

  if (secretKey) {
    return signEnvelope(msg, secretKey);
  }

  return {
    ...msg,
    sig: ""
  };
}
