import { CreditLedger } from "./creditLedger.js";
import { TenantConfig } from "../types/tenant.js";

export type AiDecision =
  | { allowed: true; reason: string; creditsToSpend: number }
  | { allowed: false; reason: string };

export class AiAccessPolicy {
  constructor(private readonly creditLedger: CreditLedger) {}

  async evaluateIntentParsing(tenant: TenantConfig): Promise<AiDecision> {
    if (!tenant.aiAddonEnabled) {
      return {
        allowed: false,
        reason: "tenant นี้ยังไม่ได้เปิด AI Add-on"
      };
    }

    if (tenant.aiMode === "disabled") {
      return {
        allowed: false,
        reason: "tenant นี้ปิดการใช้งาน AI"
      };
    }

    if (tenant.aiMode === "byo-key") {
      return {
        allowed: true,
        reason: "tenant นี้ใช้ BYO AI key",
        creditsToSpend: 0
      };
    }

    const creditsToSpend = 1;
    if (!(await this.creditLedger.canSpend(tenant, creditsToSpend))) {
      return {
        allowed: false,
        reason: "เครดิต AI ไม่เพียงพอ"
      };
    }

    return {
      allowed: true,
      reason: "tenant นี้ใช้ AI ผ่านเครดิต",
      creditsToSpend
    };
  }
}
