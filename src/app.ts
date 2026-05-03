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
    const normalizedMessage = message.toLowerCase();
    const status =
      normalizedMessage.includes("no signature") || normalizedMessage.includes("invalid signature")
        ? 401
        :
      typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
          ? error.status
          : 500;

    console.error("Request failed", {
      status,
      message
    });

    res.status(status).json({ message });
  });

  return app;
}
