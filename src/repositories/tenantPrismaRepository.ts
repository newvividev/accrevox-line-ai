import { prisma } from "../db.js";
import { TenantConfig } from "../types/tenant.js";

export class TenantPrismaRepository {
  async findByCode(code: string): Promise<TenantConfig | null> {
    const tenant = await prisma.tenant.findUnique({
      where: { code },
      include: {
        lineChannels: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: 1
        },
        accrevoxConnection: true,
        aiSubscription: true,
        creditWallet: true
      }
    });

    if (!tenant) {
      return null;
    }

    const lineChannel = tenant.lineChannels[0];
    const accrevoxConnection = tenant.accrevoxConnection;
    if (!lineChannel || !accrevoxConnection) {
      return null;
    }

    return {
      id: tenant.id,
      code: tenant.code,
      name: tenant.name,
      packagePlan: tenant.packagePlan,
      aiAddonEnabled: tenant.aiAddonEnabled && (tenant.aiSubscription?.isEnabled ?? false),
      aiMode: this.mapAiMode(tenant.aiSubscription?.mode),
      aiCreditBalance: tenant.creditWallet?.balance ?? 0,
      line: {
        channelSecret: lineChannel.channelSecret,
        channelAccessToken: lineChannel.channelAccessToken
      },
      accrevox: {
        baseUrl: accrevoxConnection.baseUrl,
        clientId: accrevoxConnection.clientId,
        clientSecret: accrevoxConnection.clientSecret,
        companyApiKey: accrevoxConnection.companyApiKey
      },
      defaults: {
        branchCode: "00000",
        vatMethod: "PER_ITEM",
        priceMethod: "INCLUSIVE",
        approvalPerson: "",
        createdPerson: ""
      }
    };
  }

  private mapAiMode(mode: string | undefined): TenantConfig["aiMode"] {
    if (!mode) {
      return "disabled";
    }

    if (mode === "byo_key") {
      return "byo-key";
    }

    if (mode === "credit") {
      return "credit";
    }

    return "disabled";
  }
}
