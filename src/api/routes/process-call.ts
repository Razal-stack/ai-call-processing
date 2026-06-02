// Wiring only: maps POST /process-call to its controller. The handler logic
// lives in the controller; business logic lives in services/ + domain/.

import { Router } from "express";
import type { Env } from "../../config/env.js";
import type { ExtractionService } from "../../services/extraction.service.js";
import { processCallController } from "../controllers/process-call.controller.js";

/** Router exposing POST /process-call. */
export function processCallRouter(service: ExtractionService, env: Env): Router {
  const router = Router();
  router.post("/process-call", processCallController(service, env));
  return router;
}
