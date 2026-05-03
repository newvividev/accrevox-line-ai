import {
  AccrevoxClient,
  BaseDocumentPayload,
  CreateDocumentResponse,
  DocumentJobStatus,
  InvoicePayload,
  ProductSearchResult,
  QuotationPayload,
  ReceiptPayload
} from "./accrevoxClient.js";
import { DocumentType, Prisma } from "@prisma/client";
import { AiAccessPolicy } from "./aiAccessPolicy.js";
import { CreditLedger } from "./creditLedger.js";
import { DocumentRequestPrismaRepository } from "../repositories/documentRequestPrismaRepository.js";
import { ParsedDocumentCommand, parseChatCommand } from "./intentParser.js";
import { config } from "../config.js";
import { OllamaIntentParser } from "./ollamaIntentParser.js";
import { OpenAiIntentParser } from "./openAiIntentParser.js";
import { TenantConfig } from "../types/tenant.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requireSingleMatch<T extends { id: string; name: string }>(
  items: T[],
  label: string,
  searchText: string
): Promise<T> {
  if (items.length === 0) {
    throw new Error(`ไม่พบ${label}: ${searchText}`);
  }

  if (items.length > 1) {
    const names = items.map((item) => item.name).join(", ");
    throw new Error(`พบ${label}หลายรายการสำหรับ "${searchText}": ${names}`);
  }

  return items[0];
}

async function mapProducts(
  client: AccrevoxClient,
  productNames: string[]
): Promise<Map<string, ProductSearchResult>> {
  const productMap = new Map<string, ProductSearchResult>();

  for (const productName of productNames) {
    const matches = await client.searchProducts(productName);
    const match = await requireSingleMatch(matches, "สินค้า", productName);
    productMap.set(productName, match);
  }

  return productMap;
}

async function pollUntilDone(
  client: AccrevoxClient,
  trackingId: string,
  maxAttempts = 12,
  delayMs = 2000
): Promise<DocumentJobStatus> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const job = await client.getDocumentJobStatus(trackingId);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await sleep(delayMs);
  }

  throw new Error(`เอกสารถูกสร้างอยู่ในระบบแล้ว แต่ยังไม่เสร็จภายใน ${maxAttempts * delayMs / 1000} วินาที`);
}

function toPrismaDocumentType(
  documentType: Extract<ParsedDocumentCommand, { kind: "create_document" }>["documentType"]
): DocumentType {
  switch (documentType) {
    case "quotation":
      return DocumentType.quotation;
    case "invoice":
      return DocumentType.invoice;
    case "receipt":
      return DocumentType.receipt;
  }
}

function getDocumentLabel(
  documentType: Extract<ParsedDocumentCommand, { kind: "create_document" }>["documentType"]
): string {
  switch (documentType) {
    case "quotation":
      return "ใบเสนอราคา";
    case "invoice":
      return "ใบแจ้งหนี้";
    case "receipt":
      return "ใบเสร็จรับเงิน";
  }
}

function buildBasePayload(
  tenant: TenantConfig,
  contactId: string,
  parsed: Extract<ParsedDocumentCommand, { kind: "create_document" }>,
  products: Map<string, ProductSearchResult>
): BaseDocumentPayload {
  return {
    issuedDate: parsed.issuedDate,
    branchCode: tenant.defaults.branchCode,
    contactId,
    vatMethod: tenant.defaults.vatMethod,
    priceMethod: tenant.defaults.priceMethod,
    approvalPerson: tenant.defaults.approvalPerson || undefined,
    createdPerson: tenant.defaults.createdPerson || undefined,
    items: parsed.items.map((item) => ({
      productId: products.get(item.productName)!.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      description: item.productName
    }))
  };
}

export class DocumentOrchestrator {
  private readonly aiIntentParser = config.ai.provider === "ollama"
    ? new OllamaIntentParser()
    : new OpenAiIntentParser();

  constructor(
    private readonly client: AccrevoxClient,
    private readonly tenant: TenantConfig,
    private readonly aiAccessPolicy: AiAccessPolicy,
    private readonly creditLedger: CreditLedger,
    private readonly documentRequestRepository: DocumentRequestPrismaRepository
  ) {}

  async handleChatMessage(message: string, lineUserId?: string): Promise<string> {
    const parsed = await this.parseMessage(message);
    const documentRequest = await this.documentRequestRepository.createReceivedRequest({
      tenantId: this.tenant.id,
      lineUserId,
      sourceText: message,
      documentType: parsed.kind === "create_document" ? toPrismaDocumentType(parsed.documentType) : DocumentType.quotation
    });

    try {
      if (parsed.kind === "unsupported") {
        const aiDecision = await this.aiAccessPolicy.evaluateIntentParsing(this.tenant);
        const aiHint = aiDecision.allowed
          ? "ในขั้นถัดไปสามารถต่อ AI parser สำหรับภาษาธรรมชาติได้"
          : `ตอนนี้ระบบจะใช้คำสั่งแบบตายตัว: ${aiDecision.reason}`;

        await this.documentRequestRepository.markAsFailed({
          documentRequestId: documentRequest.id,
          message: parsed.reason
        });

        return [
          parsed.reason,
          "",
          aiHint,
          "",
          "ตัวอย่าง:",
          "ออกใบเสนอราคา ลูกค้า=บริษัท ABC วันที่=2026-05-03 รายการ=ปากกา,10,20;สมุด,5,50",
          "ออกใบแจ้งหนี้ ลูกค้า=บริษัท ABC วันที่=2026-05-03 ครบกำหนด=2026-05-10 รายการ=ปากกา,10,20",
          "ออกใบเสร็จ ลูกค้า=บริษัท ABC วันที่=2026-05-03 ครบกำหนด=2026-05-03 รายการ=ปากกา,10,20"
        ].join("\n");
      }

      const parsedPayloadJson: Prisma.InputJsonValue = {
        documentType: parsed.documentType,
        contactName: parsed.contactName,
        issuedDate: parsed.issuedDate,
        dueDate: parsed.dueDate ?? null,
        items: parsed.items
      };
      await this.documentRequestRepository.markAsValidating(documentRequest.id, parsedPayloadJson);

      const contacts = await this.client.searchContacts(parsed.contactName);
      const contact = await requireSingleMatch(contacts, "ลูกค้า", parsed.contactName);
      const products = await mapProducts(this.client, parsed.items.map((item) => item.productName));
      const basePayload = buildBasePayload(this.tenant, contact.id, parsed, products);
      const { created, payload } = await this.createDocument(parsed, basePayload);

      await this.documentRequestRepository.markAsSubmitted(
        documentRequest.id,
        created.trackingId,
        created.documentNumber,
        payload as Prisma.InputJsonValue
      );

      return this.buildFinalMessage(
        documentRequest.id,
        parsed.documentType,
        created,
        payload as Prisma.InputJsonValue
      );
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown document orchestration error";
      await this.documentRequestRepository.markAsFailed({
        documentRequestId: documentRequest.id,
        message: messageText
      });
      throw error;
    }
  }

  private async parseMessage(message: string): Promise<ParsedDocumentCommand> {
    const parsed = parseChatCommand(message);
    if (parsed.kind === "create_document") {
      return parsed;
    }

    const aiDecision = await this.aiAccessPolicy.evaluateIntentParsing(this.tenant);
    if (!aiDecision.allowed) {
      return parsed;
    }

    if (!this.aiIntentParser.isConfigured()) {
      return {
        kind: "unsupported",
        reason: `${parsed.reason}\nAI fallback ยังไม่ได้เปิดใช้งานในระบบสำหรับ provider ${config.ai.provider}`
      };
    }

    let aiParsed: ParsedDocumentCommand;
    try {
      aiParsed = await this.aiIntentParser.parse(message);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "AI fallback failed";
      return {
        kind: "unsupported",
        reason: `${parsed.reason}\nAI fallback ใช้งานไม่สำเร็จ: ${messageText}`
      };
    }

    await this.creditLedger.spendCredits(
      this.tenant,
      aiDecision.creditsToSpend,
      `AI intent parsing for "${message.slice(0, 80)}"`
    );

    return aiParsed.kind === "create_document" ? aiParsed : {
      kind: "unsupported",
      reason: aiParsed.reason
    };
  }

  private async createDocument(
    parsed: Extract<ParsedDocumentCommand, { kind: "create_document" }>,
    basePayload: BaseDocumentPayload
  ): Promise<{
    created: CreateDocumentResponse;
    payload: QuotationPayload | InvoicePayload | ReceiptPayload;
  }> {
    switch (parsed.documentType) {
      case "quotation": {
        const payload: QuotationPayload = basePayload;
        return {
          created: await this.client.createQuotation(payload),
          payload
        };
      }
      case "invoice": {
        const payload: InvoicePayload = {
          ...basePayload,
          headerType: "INVOICE",
          dueDate: parsed.dueDate!
        };
        return {
          created: await this.client.createInvoice(payload),
          payload
        };
      }
      case "receipt": {
        const payload: ReceiptPayload = {
          ...basePayload,
          headerType: "RECEIPT",
          dueDate: parsed.dueDate!
        };
        return {
          created: await this.client.createReceipt(payload),
          payload
        };
      }
    }
  }

  private async buildFinalMessage(
    documentRequestId: string,
    documentType: Extract<ParsedDocumentCommand, { kind: "create_document" }>["documentType"],
    created: CreateDocumentResponse,
    parsedPayloadJson?: Prisma.InputJsonValue
  ): Promise<string> {
    const job = await pollUntilDone(this.client, created.trackingId);

    if (job.status === "failed") {
      const errorText = (job.errors ?? [])
        .map((error) => `${error.code}: ${error.message}`)
        .join("\n");

      await this.documentRequestRepository.markJobFailed(
        documentRequestId,
        errorText || job.message,
        job as unknown as Prisma.InputJsonValue
      );

      return [
        `สร้าง${getDocumentLabel(documentType)}ไม่สำเร็จ`,
        `เลขเอกสาร: ${created.documentNumber}`,
        errorText || job.message
      ].join("\n");
    }

    await this.documentRequestRepository.markAsCompleted({
      documentRequestId,
      trackingId: created.trackingId,
      documentNumber: created.documentNumber,
      parsedPayloadJson,
      accrevoxDocumentId: job.result?.id,
      pdfUrl: job.result?.pdfUrl,
      message: job.message,
      rawResultJson: job as unknown as Prisma.InputJsonValue
    });

    return [
      `สร้าง${getDocumentLabel(documentType)}สำเร็จ`,
      `เลขเอกสาร: ${created.documentNumber}`,
      `trackingId: ${created.trackingId}`,
      job.result?.pdfUrl ? `PDF: ${job.result.pdfUrl}` : "PDF: ยังไม่พบ pdfUrl ในผลลัพธ์ job"
    ].join("\n");
  }
}
