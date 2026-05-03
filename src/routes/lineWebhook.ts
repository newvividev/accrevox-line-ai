import { Client, middleware, MiddlewareConfig, WebhookEvent } from "@line/bot-sdk";
import { Router } from "express";
import { AccrevoxClient } from "../services/accrevoxClient.js";
import { AiAccessPolicy } from "../services/aiAccessPolicy.js";
import { CreditLedger } from "../services/creditLedger.js";
import { DocumentOrchestrator } from "../services/documentOrchestrator.js";
import { CreditWalletPrismaRepository } from "../repositories/creditWalletPrismaRepository.js";
import { DocumentRequestPrismaRepository } from "../repositories/documentRequestPrismaRepository.js";
import { LineUserConnectionPrismaRepository } from "../repositories/lineUserConnectionPrismaRepository.js";
import { TenantPrismaRepository } from "../repositories/tenantPrismaRepository.js";

const tenantRepository = new TenantPrismaRepository();
const creditLedger = new CreditLedger(new CreditWalletPrismaRepository());
const documentRequestRepository = new DocumentRequestPrismaRepository();
const lineUserConnectionRepository = new LineUserConnectionPrismaRepository();

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
    creditLedger,
    documentRequestRepository
  );

  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  try {
    const lineUserId = event.source.type === "user" ? event.source.userId : undefined;
    const replyText = lineUserId
      ? await handleTextMessage(event.message.text, lineUserId, tenant, orchestrator)
      : await orchestrator.handleChatMessage(event.message.text, lineUserId);

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

async function handleTextMessage(
  messageText: string,
  lineUserId: string,
  tenant: NonNullable<Awaited<ReturnType<TenantPrismaRepository["findByCode"]>>>,
  orchestrator: DocumentOrchestrator
): Promise<string> {
  const normalizedText = messageText.trim();

  if (normalizedText === "เชื่อมต่อ Accrevox") {
    await lineUserConnectionRepository.setAwaitingApiKey(tenant.id, lineUserId);
    return "กรุณาส่ง Company API Key ของ Accrevox เพื่อเชื่อมต่อ";
  }

  const userState = await lineUserConnectionRepository.getState(tenant.id, lineUserId);
  if (userState?.state === "awaiting_api_key") {
    if (normalizedText === "ยกเลิก") {
      await lineUserConnectionRepository.clearState(tenant.id, lineUserId);
      return "ยกเลิกการเชื่อมต่อ Accrevox แล้ว";
    }

    const validationClient = new AccrevoxClient(
      tenant.accrevox.baseUrl,
      tenant.accrevox.clientId,
      tenant.accrevox.clientSecret,
      normalizedText
    );

    try {
      const company = await validationClient.getCompany();
      await tenantRepository.updateCompanyApiKey(tenant.id, normalizedText);
      await lineUserConnectionRepository.upsertConnection(tenant.id, lineUserId, company.id, company.name);
      await lineUserConnectionRepository.clearState(tenant.id, lineUserId);

      return `เชื่อมต่อ Accrevox สำเร็จ\nบริษัท: ${company.name}`;
    } catch {
      return "API Key ไม่ถูกต้อง หรือไม่สามารถเชื่อมต่อกับ Accrevox ได้\nกรุณาส่ง Company API Key ใหม่ หรือพิมพ์ ยกเลิก";
    }
  }

  return orchestrator.handleChatMessage(messageText, lineUserId);
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
