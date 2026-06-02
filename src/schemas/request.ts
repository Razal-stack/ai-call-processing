/*
 * Request contract for POST /process-call — the 400 boundary. The 413 size cap
 * is enforced in the route (it needs the configured limit + a different status).
 * `.strict()` rejects unknown keys so client typos surface loudly.
 */

import { z } from "zod";

export const ProcessCallRequestSchema = z
  .object({
    transcript: z
      .string({ error: "transcript is required and must be a string" })
      .trim()
      .min(1, "transcript must not be empty"),
  })
  .strict();

export type ProcessCallRequest = z.infer<typeof ProcessCallRequestSchema>;
