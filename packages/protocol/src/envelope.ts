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
