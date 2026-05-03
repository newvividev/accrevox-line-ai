import express from "express";
import { createAdminRouter } from "./routes/adminRouter.js";
import { createLineWebhookRouter } from "./routes/lineWebhook.js";

export function createApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/admin", createAdminRouter());
  app.use("/webhooks/line", createLineWebhookRouter());

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ message });
  });

  return app;
}
