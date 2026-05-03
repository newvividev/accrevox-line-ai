import {
  AccrevoxClient,
  CreateDocumentResponse,
  DocumentJobStatus,
  ProductSearchResult,
  QuotationPayload
} from "./accrevoxClient.js";
import { AiAccessPolicy } from "./aiAccessPolicy.js";
import { CreditLedger } from "./creditLedger.js";
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
    private readonly creditLedger: CreditLedger
  ) {}

  async handleChatMessage(message: string): Promise<string> {
    const parsed = parseChatCommand(message);

    if (parsed.kind === "unsupported") {
      const aiDecision = await this.aiAccessPolicy.evaluateIntentParsing(this.tenant);
      const aiHint = aiDecision.allowed
        ? "ในขั้นถัดไปสามารถต่อ AI parser สำหรับภาษาธรรมชาติได้"
        : `ตอนนี้ระบบจะใช้คำสั่งแบบตายตัว: ${aiDecision.reason}`;

      return [
        parsed.reason,
        "",
        aiHint,
        "",
        "ตัวอย่าง:",
        "ออกใบเสนอราคา ลูกค้า=บริษัท ABC วันที่=2026-05-03 รายการ=ปากกา,10,20;สมุด,5,50"
      ].join("\n");
    }

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
    return this.buildFinalMessage(created);
  }

  private async buildFinalMessage(created: CreateDocumentResponse): Promise<string> {
    const job = await pollUntilDone(this.client, created.trackingId);

    if (job.status === "failed") {
      const errorText = (job.errors ?? [])
        .map((error) => `${error.code}: ${error.message}`)
        .join("\n");

      return [
        `สร้างเอกสารไม่สำเร็จ`,
        `เลขเอกสาร: ${created.documentNumber}`,
        errorText || job.message
      ].join("\n");
    }

    return [
      `สร้างใบเสนอราคาสำเร็จ`,
      `เลขเอกสาร: ${created.documentNumber}`,
      `trackingId: ${created.trackingId}`,
      job.result?.pdfUrl ? `PDF: ${job.result.pdfUrl}` : "PDF: ยังไม่พบ pdfUrl ในผลลัพธ์ job"
    ].join("\n");
  }
}
