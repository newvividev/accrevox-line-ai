import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  ai: {
    provider: (process.env.AI_PROVIDER?.trim() || "openai") as "openai" | "ollama",
    openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-5-nano",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    ollamaModel: process.env.OLLAMA_MODEL?.trim() || "llama3:latest"
  },
  line: {
    channelSecret: required("LINE_CHANNEL_SECRET"),
    channelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN")
  },
  accrevox: {
    baseUrl: required("ACCREVOX_BASE_URL"),
    clientId: required("ACCREVOX_CLIENT_ID"),
    clientSecret: required("ACCREVOX_CLIENT_SECRET"),
    companyApiKey: required("ACCREVOX_COMPANY_API_KEY")
  },
  openai: {
    apiKey: optional("OPENAI_API_KEY"),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-5-nano"
  },
  defaults: {
    branchCode: process.env.DEFAULT_BRANCH_CODE ?? "00000",
    vatMethod: process.env.DEFAULT_VAT_METHOD ?? "PER_ITEM",
    priceMethod: process.env.DEFAULT_PRICE_METHOD ?? "INCLUSIVE",
    approvalPerson: process.env.DEFAULT_APPROVAL_PERSON ?? "",
    createdPerson: process.env.DEFAULT_CREATED_PERSON ?? ""
  }
} as const;
