import { CreditTransactionType } from "@prisma/client";
import { prisma } from "../db.js";

export class CreditWalletPrismaRepository {
  async getBalanceByTenantId(tenantId: string): Promise<number> {
    const wallet = await prisma.creditWallet.findUnique({
      where: { tenantId }
    });

    return wallet?.balance ?? 0;
  }

  async spendCredits(tenantId: string, amount: number, reason: string): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const wallet = await tx.creditWallet.findUnique({
        where: { tenantId }
      });

      if (!wallet) {
        throw new Error(`ไม่พบ credit wallet ของ tenant ${tenantId}`);
      }

      if (wallet.balance < amount) {
        throw new Error(`เครดิตไม่เพียงพอสำหรับ tenant ${tenantId}`);
      }

      const updated = await tx.creditWallet.update({
        where: { tenantId },
        data: {
          balance: wallet.balance - amount
        }
      });

      await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          type: CreditTransactionType.debit,
          amount: -amount,
          balanceAfter: updated.balance,
          reason,
          referenceType: "ai_usage"
        }
      });

      return updated.balance;
    });
  }

  async topUpCredits(tenantId: string, amount: number, reason: string): Promise<number> {
    if (amount <= 0) {
      throw new Error("จำนวนเครดิตที่เติมต้องมากกว่า 0");
    }

    return prisma.$transaction(async (tx) => {
      const wallet = await tx.creditWallet.findUnique({
        where: { tenantId }
      });

      if (!wallet) {
        throw new Error(`ไม่พบ credit wallet ของ tenant ${tenantId}`);
      }

      const updated = await tx.creditWallet.update({
        where: { tenantId },
        data: {
          balance: wallet.balance + amount
        }
      });

      await tx.creditTransaction.create({
        data: {
          walletId: wallet.id,
          type: CreditTransactionType.topup,
          amount,
          balanceAfter: updated.balance,
          reason,
          referenceType: "admin_topup"
        }
      });

      return updated.balance;
    });
  }

  async listTransactionsByTenantId(tenantId: string, limit = 20) {
    const wallet = await prisma.creditWallet.findUnique({
      where: { tenantId },
      select: { id: true }
    });

    if (!wallet) {
      throw new Error(`ไม่พบ credit wallet ของ tenant ${tenantId}`);
    }

    return prisma.creditTransaction.findMany({
      where: {
        walletId: wallet.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: limit
    });
  }
}
