// GET /health — cheap liveness probe; no LLM call, so no provider cost.

import { Router } from "express";

/** Router exposing GET /health. */
export function healthRouter(): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  return router;
}
