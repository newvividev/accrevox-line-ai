import { CreditUsageRecord, TenantConfig } from "../types/tenant.js";
import { CreditWalletPrismaRepository } from "../repositories/creditWalletPrismaRepository.js";

export class CreditLedger {
  private readonly usageRecords: CreditUsageRecord[] = [];

  constructor(private readonly walletRepository?: CreditWalletPrismaRepository) {}

  async getBalance(tenant: TenantConfig): Promise<number> {
    if (this.walletRepository) {
      return this.walletRepository.getBalanceByTenantId(tenant.id);
    }

    return tenant.aiCreditBalance;
  }

  async canSpend(tenant: TenantConfig, credits: number): Promise<boolean> {
    return (await this.getBalance(tenant)) >= credits;
  }

  async spendCredits(tenant: TenantConfig, credits: number, reason: string): Promise<void> {
    if (!(await this.canSpend(tenant, credits))) {
      throw new Error(`เครดิตไม่เพียงพอสำหรับ tenant ${tenant.code}`);
    }

    if (this.walletRepository) {
      await this.walletRepository.spendCredits(tenant.id, credits, reason);
    } else {
      tenant.aiCreditBalance -= credits;
    }

    this.usageRecords.push({
      tenantId: tenant.id,
      feature: "chat_intent_parse",
      creditsUsed: credits,
      reason,
      createdAt: new Date().toISOString()
    });
  }

  listUsageRecords(): CreditUsageRecord[] {
    return [...this.usageRecords];
  }
}
