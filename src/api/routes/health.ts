import { Router } from "express";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "auto-staff-ai",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  return router;
}
