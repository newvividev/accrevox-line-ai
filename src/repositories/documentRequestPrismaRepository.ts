import { DocumentRequestStatus, DocumentType, JobStatus, Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type CreateDocumentRequestInput = {
  tenantId: string;
  lineUserId?: string;
  sourceText: string;
  documentType: DocumentType;
};

export type CompleteDocumentRequestInput = {
  documentRequestId: string;
  trackingId: string;
  documentNumber: string;
  parsedPayloadJson?: Prisma.InputJsonValue;
  accrevoxDocumentId?: string;
  pdfUrl?: string;
  message?: string;
  rawResultJson?: Prisma.InputJsonValue;
};

export type FailDocumentRequestInput = {
  documentRequestId: string;
  parsedPayloadJson?: Prisma.InputJsonValue;
  message: string;
  rawResultJson?: Prisma.InputJsonValue;
};

export class DocumentRequestPrismaRepository {
  async listByTenantId(tenantId: string, limit = 20) {
    return prisma.documentRequest.findMany({
      where: { tenantId },
      orderBy: {
        createdAt: "desc"
      },
      take: limit,
      include: {
        jobs: {
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });
  }

  async createReceivedRequest(input: CreateDocumentRequestInput) {
    return prisma.documentRequest.create({
      data: {
        tenantId: input.tenantId,
        lineUserId: input.lineUserId,
        sourceText: input.sourceText,
        documentType: input.documentType,
        status: DocumentRequestStatus.received
      }
    });
  }

  async markAsValidating(documentRequestId: string, parsedPayloadJson?: Prisma.InputJsonValue) {
    return prisma.documentRequest.update({
      where: { id: documentRequestId },
      data: {
        status: DocumentRequestStatus.validating,
        parsedPayloadJson
      }
    });
  }

  async markAsSubmitted(
    documentRequestId: string,
    trackingId: string,
    documentNumber: string,
    parsedPayloadJson?: Prisma.InputJsonValue
  ) {
    return prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.documentRequest.update({
        where: { id: documentRequestId },
        data: {
          status: DocumentRequestStatus.submitted,
          parsedPayloadJson,
          documentNumber
        }
      });

      await tx.documentJob.create({
        data: {
          documentRequestId,
          trackingId,
          status: JobStatus.pending
        }
      });

      return updatedRequest;
    });
  }

  async markAsCompleted(input: CompleteDocumentRequestInput) {
    return prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.documentRequest.update({
        where: { id: input.documentRequestId },
        data: {
          status: DocumentRequestStatus.completed,
          parsedPayloadJson: input.parsedPayloadJson,
          documentNumber: input.documentNumber,
          accrevoxDocumentId: input.accrevoxDocumentId
        }
      });

      await tx.documentJob.update({
        where: { trackingId: input.trackingId },
        data: {
          status: JobStatus.completed,
          message: input.message,
          pdfUrl: input.pdfUrl,
          rawResultJson: input.rawResultJson
        }
      });

      return updatedRequest;
    });
  }

  async markAsFailed(input: FailDocumentRequestInput) {
    return prisma.documentRequest.update({
      where: { id: input.documentRequestId },
      data: {
        status: DocumentRequestStatus.failed,
        parsedPayloadJson: input.parsedPayloadJson,
        accrevoxDocumentId: null
      }
    });
  }

  async markJobFailed(documentRequestId: string, message: string, rawResultJson?: Prisma.InputJsonValue) {
    return prisma.$transaction(async (tx) => {
      await tx.documentRequest.update({
        where: { id: documentRequestId },
        data: {
          status: DocumentRequestStatus.failed
        }
      });

      await tx.documentJob.updateMany({
        where: { documentRequestId },
        data: {
          status: JobStatus.failed,
          message,
          rawResultJson
        }
      });
    });
  }
}
