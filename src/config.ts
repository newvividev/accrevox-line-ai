import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
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
  defaults: {
    branchCode: process.env.DEFAULT_BRANCH_CODE ?? "00000",
    vatMethod: process.env.DEFAULT_VAT_METHOD ?? "PER_ITEM",
    priceMethod: process.env.DEFAULT_PRICE_METHOD ?? "INCLUSIVE",
    approvalPerson: process.env.DEFAULT_APPROVAL_PERSON ?? "",
    createdPerson: process.env.DEFAULT_CREATED_PERSON ?? ""
  }
} as const;
