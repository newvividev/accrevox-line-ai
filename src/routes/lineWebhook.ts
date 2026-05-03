import { Client, middleware, MiddlewareConfig, WebhookEvent } from "@line/bot-sdk";
import { Router } from "express";
import { AccrevoxClient } from "../services/accrevoxClient.js";
import { AiAccessPolicy } from "../services/aiAccessPolicy.js";
import { CreditLedger } from "../services/creditLedger.js";
import { DocumentOrchestrator } from "../services/documentOrchestrator.js";
import { CreditWalletPrismaRepository } from "../repositories/creditWalletPrismaRepository.js";
import { TenantPrismaRepository } from "../repositories/tenantPrismaRepository.js";

const tenantRepository = new TenantPrismaRepository();
const creditLedger = new CreditLedger(new CreditWalletPrismaRepository());

function createMiddlewareConfig(channelSecret: string, channelAccessToken: string): MiddlewareConfig {
  return {
    channelAccessToken,
    channelSecret
  };
}

async function handleEvent(event: WebhookEvent, tenantId: string): Promise<void> {
  const tenant = await tenantRepository.findByCode(tenantId);
  if (!tenant) {
    throw new Error(`ไม่พบ tenant: ${tenantId}`);
  }

  const lineClient = new Client({
    channelAccessToken: tenant.line.channelAccessToken
  });

  const accrevoxClient = new AccrevoxClient(
    tenant.accrevox.baseUrl,
    tenant.accrevox.clientId,
    tenant.accrevox.clientSecret,
    tenant.accrevox.companyApiKey
  );

  const aiAccessPolicy = new AiAccessPolicy(creditLedger);
  const orchestrator = new DocumentOrchestrator(
    accrevoxClient,
    tenant,
    aiAccessPolicy,
    creditLedger
  );

  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  try {
    const replyText = await orchestrator.handleChatMessage(event.message.text);
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: replyText
        }
      ]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: `ไม่สามารถสร้างเอกสารได้\n${message}`
        }
      ]
    });
  }
}

export function createLineWebhookRouter(): Router {
  const router = Router();

  router.post("/:tenantId", async (req, res, next) => {
    const tenant = await tenantRepository.findByCode(req.params.tenantId);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const tenantMiddleware = middleware(
      createMiddlewareConfig(tenant.line.channelSecret, tenant.line.channelAccessToken)
    );

    tenantMiddleware(req, res, next);
  });

  router.post("/:tenantId", async (req, res) => {
    const events = req.body.events as WebhookEvent[];
    const tenantId = req.params.tenantId;
    await Promise.all(events.map((event) => handleEvent(event, tenantId)));
    res.status(200).json({ ok: true });
  });

  return router;
}
