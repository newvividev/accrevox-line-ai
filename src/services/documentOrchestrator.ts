import {
  AccrevoxClient,
  CreateDocumentResponse,
  DocumentJobStatus,
  ProductSearchResult,
  QuotationPayload
} from "./accrevoxClient.js";
import { DocumentType, Prisma } from "@prisma/client";
import { AiAccessPolicy } from "./aiAccessPolicy.js";
import { CreditLedger } from "./creditLedger.js";
import { DocumentRequestPrismaRepository } from "../repositories/documentRequestPrismaRepository.js";
import { parseChatCommand } from "./intentParser.js";
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

export class DocumentOrchestrator {
  constructor(
    private readonly client: AccrevoxClient,
    private readonly tenant: TenantConfig,
    private readonly aiAccessPolicy: AiAccessPolicy,
    private readonly creditLedger: CreditLedger,
    private readonly documentRequestRepository: DocumentRequestPrismaRepository
  ) {}

  async handleChatMessage(message: string, lineUserId?: string): Promise<string> {
    const documentRequest = await this.documentRequestRepository.createReceivedRequest({
      tenantId: this.tenant.id,
      lineUserId,
      sourceText: message,
      documentType: DocumentType.quotation
    });

    try {
      const parsed = parseChatCommand(message);

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
          "ออกใบเสนอราคา ลูกค้า=บริษัท ABC วันที่=2026-05-03 รายการ=ปากกา,10,20;สมุด,5,50"
        ].join("\n");
      }

      const parsedPayloadJson: Prisma.InputJsonValue = {
        contactName: parsed.contactName,
        issuedDate: parsed.issuedDate,
        items: parsed.items
      };
      await this.documentRequestRepository.markAsValidating(documentRequest.id, parsedPayloadJson);

      const contacts = await this.client.searchContacts(parsed.contactName);
      const contact = await requireSingleMatch(contacts, "ลูกค้า", parsed.contactName);
      const products = await mapProducts(this.client, parsed.items.map((item) => item.productName));

      const payload: QuotationPayload = {
        issuedDate: parsed.issuedDate,
        branchCode: this.tenant.defaults.branchCode,
        contactId: contact.id,
        vatMethod: this.tenant.defaults.vatMethod,
        priceMethod: this.tenant.defaults.priceMethod,
        approvalPerson: this.tenant.defaults.approvalPerson || undefined,
        createdPerson: this.tenant.defaults.createdPerson || undefined,
        items: parsed.items.map((item) => ({
          productId: products.get(item.productName)!.id,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          description: item.productName
        }))
      };

      const created = await this.client.createQuotation(payload);
      await this.documentRequestRepository.markAsSubmitted(
        documentRequest.id,
        created.trackingId,
        created.documentNumber,
        payload as Prisma.InputJsonValue
      );

      return this.buildFinalMessage(documentRequest.id, created, payload as Prisma.InputJsonValue);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown document orchestration error";
      await this.documentRequestRepository.markAsFailed({
        documentRequestId: documentRequest.id,
        message: messageText
      });
      throw error;
    }
  }

  private async buildFinalMessage(
    documentRequestId: string,
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
        `สร้างเอกสารไม่สำเร็จ`,
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
      `สร้างใบเสนอราคาสำเร็จ`,
      `เลขเอกสาร: ${created.documentNumber}`,
      `trackingId: ${created.trackingId}`,
      job.result?.pdfUrl ? `PDF: ${job.result.pdfUrl}` : "PDF: ยังไม่พบ pdfUrl ในผลลัพธ์ job"
    ].join("\n");
  }
}
