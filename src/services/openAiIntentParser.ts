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

type OpenAiResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const intentSchema = {
  name: "document_intent",
  strict: true,
  schema: {
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
  }
} as const;

function extractOutputText(response: OpenAiResponse): string {
  const textChunks: string[] = [];

  for (const outputItem of response.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "output_text" && contentItem.text) {
        textChunks.push(contentItem.text);
      }
    }
  }

  return textChunks.join("\n").trim();
}

export class OpenAiIntentParser {
  isConfigured(): boolean {
    return Boolean(config.openai.apiKey);
  }

  async parse(message: string, today = new Date()): Promise<ParsedDocumentCommand> {
    if (!config.openai.apiKey) {
      return {
        kind: "unsupported",
        reason: "ยังไม่ได้ตั้งค่า OPENAI_API_KEY"
      };
    }

    const todayText = today.toISOString().slice(0, 10);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "You extract Thai accounting chat commands into structured JSON.",
                  "Supported document types: quotation, invoice, receipt.",
                  "Today is " + todayText + ". Convert relative dates like today/tomorrow into YYYY-MM-DD.",
                  "If required information is missing, set supported=false and explain briefly in Thai.",
                  "For invoice and receipt, dueDate is required.",
                  "Do not guess product names, quantities, prices, or customer names if absent."
                ].join(" ")
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: message
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            ...intentSchema
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI intent parser error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as OpenAiResponse;
    const outputText = extractOutputText(data);
    if (!outputText) {
      return {
        kind: "unsupported",
        reason: "AI ไม่ได้ส่งผลลัพธ์กลับมา"
      };
    }

    const parsed = JSON.parse(outputText) as AiIntentResponse;
    if (!parsed.supported || !parsed.documentType || !parsed.contactName || !parsed.issuedDate || !parsed.items?.length) {
      return {
        kind: "unsupported",
        reason: parsed.reason || "AI ยังสรุปคำสั่งนี้ไม่ได้"
      };
    }

    if ((parsed.documentType === "invoice" || parsed.documentType === "receipt") && !parsed.dueDate) {
      return {
        kind: "unsupported",
        reason: "AI ยังระบุวันครบกำหนดไม่ได้ กรุณาระบุวันครบกำหนดเพิ่ม"
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
