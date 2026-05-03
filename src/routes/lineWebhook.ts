import { Client, HTTPError, middleware, MiddlewareConfig, WebhookEvent } from "@line/bot-sdk";
import { Router } from "express";
import { CreditWalletPrismaRepository } from "../repositories/creditWalletPrismaRepository.js";
import { DocumentRequestPrismaRepository } from "../repositories/documentRequestPrismaRepository.js";
import { LineUserConnectionPrismaRepository } from "../repositories/lineUserConnectionPrismaRepository.js";
import { TenantPrismaRepository } from "../repositories/tenantPrismaRepository.js";
import { AccrevoxClient } from "../services/accrevoxClient.js";
import { AiAccessPolicy } from "../services/aiAccessPolicy.js";
import { CreditLedger } from "../services/creditLedger.js";
import { DocumentOrchestrator } from "../services/documentOrchestrator.js";

const tenantRepository = new TenantPrismaRepository();
const creditLedger = new CreditLedger(new CreditWalletPrismaRepository());
const documentRequestRepository = new DocumentRequestPrismaRepository();
const lineUserConnectionRepository = new LineUserConnectionPrismaRepository();

function asyncRoute(handler: (req: RouterRequest, res: RouterResponse, next: RouterNext) => Promise<void>) {
  return (req: RouterRequest, res: RouterResponse, next: RouterNext) => {
    void handler(req, res, next).catch(next);
  };
}

type RouterRequest = Parameters<Router["post"]>[1] extends (req: infer T, res: any, next: any) => any ? T : never;
type RouterResponse = Parameters<Router["post"]>[1] extends (req: any, res: infer T, next: any) => any ? T : never;
type RouterNext = Parameters<Router["post"]>[1] extends (req: any, res: any, next: infer T) => any ? T : never;

function createMiddlewareConfig(channelSecret: string, channelAccessToken: string): MiddlewareConfig {
  return {
    channelAccessToken,
    channelSecret
  };
}

async function sendLineText(lineClient: Client, event: WebhookEvent, text: string): Promise<void> {
  const messages = [
    {
      type: "text" as const,
      text
    }
  ];

  if (event.source.type === "user") {
    await lineClient.pushMessage(event.source.userId, messages);
    return;
  }

  await lineClient.replyMessage(event.replyToken, messages);
}

function buildSearchClient(tenant: NonNullable<Awaited<ReturnType<TenantPrismaRepository["findByCode"]>>>) {
  return new AccrevoxClient(
    tenant.accrevox.baseUrl,
    tenant.accrevox.clientId,
    tenant.accrevox.clientSecret,
    tenant.accrevox.companyApiKey
  );
}

async function formatContactsReply(searchClient: AccrevoxClient, searchText: string): Promise<string> {
  const contacts = await searchClient.searchContacts(searchText);
  if (contacts.length === 0) {
    return searchText ? `ไม่พบลูกค้าที่ค้นหา: ${searchText}` : "ไม่พบข้อมูลลูกค้า";
  }

  const lines = contacts.slice(0, 10).map((contact, index) => `${index + 1}. ${contact.name}`);
  return [
    searchText ? `ผลการค้นหาลูกค้า: ${searchText}` : "รายการลูกค้า",
    ...lines
  ].join("\n");
}

async function formatProductsReply(searchClient: AccrevoxClient, searchText: string): Promise<string> {
  const products = await searchClient.searchProducts(searchText);
  if (products.length === 0) {
    return searchText ? `ไม่พบสินค้าที่ค้นหา: ${searchText}` : "ไม่พบข้อมูลสินค้า";
  }

  const lines = products.slice(0, 10).map((product, index) => `${index + 1}. ${product.name}`);
  return [
    searchText ? `ผลการค้นหาสินค้า: ${searchText}` : "รายการสินค้า",
    ...lines
  ].join("\n");
}

async function handleEvent(event: WebhookEvent, tenantCode: string): Promise<void> {
  const tenant = await tenantRepository.findByCode(tenantCode);
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantCode}`);
  }

  const lineClient = new Client({
    channelAccessToken: tenant.line.channelAccessToken
  });

  const accrevoxClient = buildSearchClient(tenant);
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

    console.log("Replying to LINE event", {
      tenantCode,
      eventType: event.type,
      sourceType: event.source.type,
      messageText: event.message.text,
      replyText
    });

    await sendLineText(lineClient, event, replyText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    if (error instanceof HTTPError) {
      console.error("LINE API error", {
        statusCode: error.statusCode,
        message: error.message,
        details: error.body
      });
    } else {
      console.error("Webhook event handling error", error);
    }

    await sendLineText(lineClient, event, `ไม่สามารถสร้างเอกสารได้\n${message}`);
  }
}

async function handleTextMessage(
  messageText: string,
  lineUserId: string,
  tenant: NonNullable<Awaited<ReturnType<TenantPrismaRepository["findByCode"]>>>,
  orchestrator: DocumentOrchestrator
): Promise<string> {
  const normalizedText = messageText.trim();
  const loweredText = normalizedText.toLowerCase();
  const searchClient = buildSearchClient(tenant);

  if (normalizedText === "เชื่อมต่อ Accrevox" || normalizedText === "เชื่อมต่อ accrevox") {
    await lineUserConnectionRepository.setAwaitingApiKey(tenant.id, lineUserId);
    return "กรุณาส่ง Company API Key ของ Accrevox เพื่อเชื่อมต่อ";
  }

  const customerPatterns = [
    /^ดูลูกค้า(?:\s+(.*))?$/i,
    /^มีลูกค้าอะไรบ้าง$/i,
    /^ลูกค้ามีอะไรบ้าง$/i,
    /^ดูลิสต์ลูกค้า$/i
  ];
  const customerMatch = customerPatterns.map((pattern) => normalizedText.match(pattern)).find(Boolean);
  if (customerMatch) {
    const searchText = customerMatch[1]?.trim() ?? "";
    return formatContactsReply(searchClient, searchText);
  }

  const productPatterns = [
    /^ดูสินค้า(?:\s+(.*))?$/i,
    /^ดู item(?:\s+(.*))?$/i,
    /^ดู items(?:\s+(.*))?$/i,
    /^มีสินค้าอะไรบ้าง$/i,
    /^มี item อะไรบ้าง$/i,
    /^item มีอะไรบ้าง$/i,
    /^สินค้ามีอะไรบ้าง$/i,
    /^ดูลิสต์สินค้า$/i
  ];
  const productMatch = productPatterns.map((pattern) => normalizedText.match(pattern)).find(Boolean);
  if (productMatch) {
    const searchText = productMatch[1]?.trim() ?? "";
    return formatProductsReply(searchClient, searchText);
  }

  if (loweredText === "ช่วยอะไรได้บ้าง" || loweredText === "คุณทำอะไรได้บ้าง") {
    return [
      "ตอนนี้ฉันช่วยได้ประมาณนี้",
      "1. เชื่อมต่อ Accrevox",
      "2. ดูลูกค้า",
      "3. ดูสินค้า",
      "4. ออกใบเสนอราคาแบบคำสั่งตายตัว",
      "",
      "ตัวอย่าง:",
      "ออกใบเสนอราคา ลูกค้า=บริษัท ABC วันที่=2026-05-03 รายการ=ปากกา,10,20",
      "หรือ",
      "ออกใบเสนอราคา ลูกค้า=บริษัท ABC วันที่=2026-05-03 รายการ=ปากกา 10 20"
    ].join("\n");
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

  router.post("/:tenantId", asyncRoute(async (req, res, next) => {
    const tenant = await tenantRepository.findByCode(req.params.tenantId);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const tenantMiddleware = middleware(
      createMiddlewareConfig(tenant.line.channelSecret, tenant.line.channelAccessToken)
    );

    tenantMiddleware(req, res, next);
  }));

  router.post("/:tenantId", asyncRoute(async (req, res) => {
    const events = req.body.events as WebhookEvent[];
    const tenantCode = req.params.tenantId;
    await Promise.all(events.map((event) => handleEvent(event, tenantCode)));
    res.status(200).json({ ok: true });
  }));

  return router;
}
