import { config } from "../config.js";
import { ParsedDocumentCommand } from "./intentParser.js";

type AiIntentResponse = {
  supported: boolean;
  reason?: string;
  documentType?: "quotation" | "invoice" | "receipt";
  contactName?: string;
  issuedDate?: string;
  dueDate?: string;
  items?: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
};

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

const intentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "supported",
    "reason",
    "documentType",
    "contactName",
    "issuedDate",
    "dueDate",
    "items"
  ],
  properties: {
    supported: { type: "boolean" },
    reason: { type: "string" },
    documentType: {
      type: ["string", "null"],
      enum: ["quotation", "invoice", "receipt", null]
    },
    contactName: {
      type: ["string", "null"]
    },
    issuedDate: {
      type: ["string", "null"]
    },
    dueDate: {
      type: ["string", "null"]
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productName", "quantity", "unitPrice"],
        properties: {
          productName: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: "number" }
        }
      }
    }
  }
} as const;

export class OllamaIntentParser {
  isConfigured(): boolean {
    return Boolean(config.ai.ollamaBaseUrl && config.ai.ollamaModel);
  }

  async parse(message: string, today = new Date()): Promise<ParsedDocumentCommand> {
    const todayText = today.toISOString().slice(0, 10);
    const response = await fetch(`${config.ai.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.ai.ollamaModel,
        stream: false,
        format: intentSchema,
        options: {
          temperature: 0
        },
        messages: [
          {
            role: "system",
            content: [
              "You extract Thai accounting chat commands into structured JSON.",
              "Supported document types: quotation, invoice, receipt.",
              `Today is ${todayText}. Convert relative dates like today/tomorrow into YYYY-MM-DD.`,
              "If required information is missing, set supported=false and explain briefly in Thai.",
              "For invoice and receipt, dueDate is required.",
              "Do not guess product names, quantities, prices, or customer names if absent.",
              `Return JSON that follows this schema exactly: ${JSON.stringify(intentSchema)}`
            ].join(" ")
          },
          {
            role: "user",
            content: message
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama intent parser error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as OllamaChatResponse;
    const outputText = data.message?.content?.trim();
    if (!outputText) {
      return {
        kind: "unsupported",
        reason: "Ollama ไม่ได้ส่งผลลัพธ์กลับมา"
      };
    }

    const parsed = JSON.parse(outputText) as AiIntentResponse;
    if (!parsed.supported || !parsed.documentType || !parsed.contactName || !parsed.issuedDate || !parsed.items?.length) {
      return {
        kind: "unsupported",
        reason: parsed.reason || "Ollama ยังสรุปคำสั่งนี้ไม่ได้"
      };
    }

    if ((parsed.documentType === "invoice" || parsed.documentType === "receipt") && !parsed.dueDate) {
      return {
        kind: "unsupported",
        reason: "Ollama ยังระบุวันครบกำหนดไม่ได้ กรุณาระบุวันครบกำหนดเพิ่ม"
      };
    }

    return {
      kind: "create_document",
      documentType: parsed.documentType,
      contactName: parsed.contactName,
      issuedDate: parsed.issuedDate,
      dueDate: parsed.dueDate ?? undefined,
      items: parsed.items.map((item) => ({
        productName: item.productName,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice)
      }))
    };
  }
}
