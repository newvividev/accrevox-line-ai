import express from "express";
import { createLineWebhookRouter } from "./routes/lineWebhook.js";

export function createApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/webhooks/line", createLineWebhookRouter());

  return app;
}
