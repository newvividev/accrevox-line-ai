import { LineUserStateType } from "@prisma/client";
import { prisma } from "../db.js";

export class LineUserConnectionPrismaRepository {
  async listConnectionsByTenantId(tenantId: string, limit = 50) {
    return prisma.lineUserConnection.findMany({
      where: {
        tenantId,
        isActive: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: limit
    });
  }

  async setAwaitingApiKey(tenantId: string, lineUserId: string) {
    return prisma.lineUserState.upsert({
      where: {
        tenantId_lineUserId: {
          tenantId,
          lineUserId
        }
      },
      update: {
        state: LineUserStateType.awaiting_api_key
      },
      create: {
        tenantId,
        lineUserId,
        state: LineUserStateType.awaiting_api_key
      }
    });
  }

  async getState(tenantId: string, lineUserId: string) {
    return prisma.lineUserState.findUnique({
      where: {
        tenantId_lineUserId: {
          tenantId,
          lineUserId
        }
      }
    });
  }

  async clearState(tenantId: string, lineUserId: string) {
    return prisma.lineUserState.upsert({
      where: {
        tenantId_lineUserId: {
          tenantId,
          lineUserId
        }
      },
      update: {
        state: LineUserStateType.idle
      },
      create: {
        tenantId,
        lineUserId,
        state: LineUserStateType.idle
      }
    });
  }

  async upsertConnection(tenantId: string, lineUserId: string, companyId?: string, companyName?: string) {
    return prisma.lineUserConnection.upsert({
      where: {
        tenantId_lineUserId: {
          tenantId,
          lineUserId
        }
      },
      update: {
        companyId,
        companyName,
        lastValidatedAt: new Date(),
        connectedAt: new Date(),
        isActive: true
      },
      create: {
        tenantId,
        lineUserId,
        companyId,
        companyName,
        isActive: true
      }
    });
  }
}
