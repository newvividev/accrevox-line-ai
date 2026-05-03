import { AiMode, PackagePlan, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenantCode = process.env.BOOTSTRAP_TENANT_ID ?? "demo";
  const tenantName = process.env.BOOTSTRAP_TENANT_NAME ?? "Demo Company";
  const packagePlan = (process.env.BOOTSTRAP_PACKAGE_PLAN as PackagePlan) ?? PackagePlan.core;
  const aiMode = (process.env.BOOTSTRAP_AI_MODE === "byo-key" ? AiMode.byo_key : process.env.BOOTSTRAP_AI_MODE as AiMode) ?? AiMode.credit;
  const aiAddonEnabled = (process.env.BOOTSTRAP_AI_ADDON_ENABLED ?? "true") === "true";
  const creditBalance = Number(process.env.BOOTSTRAP_AI_CREDIT_BALANCE ?? 1000);

  const tenant = await prisma.tenant.upsert({
    where: { code: tenantCode },
    update: {
      name: tenantName,
      packagePlan,
      aiAddonEnabled
    },
    create: {
      code: tenantCode,
      name: tenantName,
      packagePlan,
      aiAddonEnabled
    }
  });

  await prisma.lineChannel.upsert({
    where: { id: `${tenant.id}-line` },
    update: {
      channelSecret: process.env.LINE_CHANNEL_SECRET ?? "your-line-channel-secret",
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "your-line-channel-access-token",
      isActive: true
    },
    create: {
      id: `${tenant.id}-line`,
      tenantId: tenant.id,
      channelSecret: process.env.LINE_CHANNEL_SECRET ?? "your-line-channel-secret",
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "your-line-channel-access-token",
      isActive: true
    }
  });

  await prisma.accrevoxConnection.upsert({
    where: { tenantId: tenant.id },
    update: {
      baseUrl: process.env.ACCREVOX_BASE_URL ?? "https://your-accrevox-host",
      clientId: process.env.ACCREVOX_CLIENT_ID ?? "your-client-id",
      clientSecret: process.env.ACCREVOX_CLIENT_SECRET ?? "your-client-secret",
      companyApiKey: process.env.ACCREVOX_COMPANY_API_KEY ?? "your-company-api-key",
      isActive: true
    },
    create: {
      tenantId: tenant.id,
      baseUrl: process.env.ACCREVOX_BASE_URL ?? "https://your-accrevox-host",
      clientId: process.env.ACCREVOX_CLIENT_ID ?? "your-client-id",
      clientSecret: process.env.ACCREVOX_CLIENT_SECRET ?? "your-client-secret",
      companyApiKey: process.env.ACCREVOX_COMPANY_API_KEY ?? "your-company-api-key",
      isActive: true
    }
  });

  await prisma.aiSubscription.upsert({
    where: { tenantId: tenant.id },
    update: {
      mode: aiMode,
      isEnabled: aiAddonEnabled
    },
    create: {
      tenantId: tenant.id,
      mode: aiMode,
      isEnabled: aiAddonEnabled
    }
  });

  await prisma.creditWallet.upsert({
    where: { tenantId: tenant.id },
    update: {
      balance: creditBalance
    },
    create: {
      tenantId: tenant.id,
      balance: creditBalance
    }
  });

  console.log(`Seeded tenant "${tenant.code}" with ${creditBalance} credits`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
