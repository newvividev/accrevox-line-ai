export type PackagePlan = "core" | "pro" | "enterprise";

export type AiMode = "disabled" | "credit" | "byo-key";

export type TenantConfig = {
  id: string;
  code: string;
  name: string;
  packagePlan: PackagePlan;
  aiAddonEnabled: boolean;
  aiMode: AiMode;
  aiCreditBalance: number;
  line: {
    channelSecret: string;
    channelAccessToken: string;
  };
  accrevox: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    companyApiKey: string;
  };
  defaults: {
    branchCode: string;
    vatMethod: string;
    priceMethod: string;
    approvalPerson: string;
    createdPerson: string;
  };
};

export type CreditUsageRecord = {
  tenantId: string;
  feature: "chat_intent_parse";
  creditsUsed: number;
  reason: string;
  createdAt: string;
};
