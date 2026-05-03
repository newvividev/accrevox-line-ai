import express, { RequestHandler, Router } from "express";
import { CreditWalletPrismaRepository } from "../repositories/creditWalletPrismaRepository.js";
import { DocumentRequestPrismaRepository } from "../repositories/documentRequestPrismaRepository.js";
import { LineUserConnectionPrismaRepository } from "../repositories/lineUserConnectionPrismaRepository.js";
import { TenantPrismaRepository } from "../repositories/tenantPrismaRepository.js";

const tenantRepository = new TenantPrismaRepository();
const creditWalletRepository = new CreditWalletPrismaRepository();
const documentRequestRepository = new DocumentRequestPrismaRepository();
const lineUserConnectionRepository = new LineUserConnectionPrismaRepository();

type TopUpBody = {
  amount?: number;
  reason?: string;
};

function getSingleRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value ?? "";
}

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function createAdminRouter(): Router {
  const router = Router();
  router.use(express.json());

  router.get("/tenants/:tenantCode", asyncRoute(async (req, res) => {
    const tenantCode = getSingleRouteParam(req.params.tenantCode);
    const tenant = await tenantRepository.getAdminSummaryByCode(tenantCode);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    res.status(200).json({
      id: tenant.id,
      code: tenant.code,
      name: tenant.name,
      packagePlan: tenant.packagePlan,
      aiAddonEnabled: tenant.aiAddonEnabled,
      aiSubscription: tenant.aiSubscription
        ? {
            mode: tenant.aiSubscription.mode,
            isEnabled: tenant.aiSubscription.isEnabled,
            monthlyCreditLimit: tenant.aiSubscription.monthlyCreditLimit
          }
        : null,
      creditWallet: tenant.creditWallet
        ? {
            balance: tenant.creditWallet.balance,
            updatedAt: tenant.creditWallet.updatedAt
          }
        : null,
      lineChannels: tenant.lineChannels,
      lineUserConnections: tenant.lineUserConnections,
      accrevoxConnection: tenant.accrevoxConnection
    });
  }));

  router.get("/tenants/:tenantCode/wallet", asyncRoute(async (req, res) => {
    const tenantCode = getSingleRouteParam(req.params.tenantCode);
    const tenant = await tenantRepository.findByCode(tenantCode);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const balance = await creditWalletRepository.getBalanceByTenantId(tenant.id);
    res.status(200).json({
      tenantId: tenant.id,
      tenantCode: tenant.code,
      balance
    });
  }));

  router.post("/tenants/:tenantCode/wallet/topup", asyncRoute(async (req, res) => {
    const tenantCode = getSingleRouteParam(req.params.tenantCode);
    const tenant = await tenantRepository.findByCode(tenantCode);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const { amount, reason }: TopUpBody = req.body ?? {};
    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      res.status(400).json({ message: "amount must be a positive number" });
      return;
    }

    const balance = await creditWalletRepository.topUpCredits(
      tenant.id,
      amount,
      reason?.trim() || "Manual admin top-up"
    );

    res.status(200).json({
      tenantId: tenant.id,
      tenantCode: tenant.code,
      balance
    });
  }));

  router.get("/tenants/:tenantCode/wallet/transactions", asyncRoute(async (req, res) => {
    const tenantCode = getSingleRouteParam(req.params.tenantCode);
    const tenant = await tenantRepository.findByCode(tenantCode);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const limitValue = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const limit = Number.isNaN(limitValue) ? 20 : Math.min(Math.max(limitValue, 1), 100);
    const transactions = await creditWalletRepository.listTransactionsByTenantId(tenant.id, limit);

    res.status(200).json({
      tenantId: tenant.id,
      tenantCode: tenant.code,
      items: transactions
    });
  }));

  router.get("/tenants/:tenantCode/line-connections", asyncRoute(async (req, res) => {
    const tenantCode = getSingleRouteParam(req.params.tenantCode);
    const tenant = await tenantRepository.findByCode(tenantCode);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const limitValue = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Number.isNaN(limitValue) ? 50 : Math.min(Math.max(limitValue, 1), 100);
    const items = await lineUserConnectionRepository.listConnectionsByTenantId(tenant.id, limit);

    res.status(200).json({
      tenantId: tenant.id,
      tenantCode: tenant.code,
      items
    });
  }));

  router.get("/tenants/:tenantCode/document-requests", asyncRoute(async (req, res) => {
    const tenantCode = getSingleRouteParam(req.params.tenantCode);
    const tenant = await tenantRepository.findByCode(tenantCode);
    if (!tenant) {
      res.status(404).json({ message: "Tenant not found" });
      return;
    }

    const limitValue = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const limit = Number.isNaN(limitValue) ? 20 : Math.min(Math.max(limitValue, 1), 100);
    const items = await documentRequestRepository.listByTenantId(tenant.id, limit);

    res.status(200).json({
      tenantId: tenant.id,
      tenantCode: tenant.code,
      items
    });
  }));

  return router;
}
