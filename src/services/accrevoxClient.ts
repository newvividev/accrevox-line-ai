import axios, { AxiosInstance } from "axios";

export type ContactSearchResult = {
  id: string;
  name: string;
};

export type ProductSearchResult = {
  id: string;
  name: string;
};

export type DocumentItemPayload = {
  productId: string;
  quantity: number;
  unitPrice: number;
  description?: string;
};

export type BaseDocumentPayload = {
  issuedDate: string;
  branchCode: string;
  contactId: string;
  vatMethod: string;
  priceMethod: string;
  approvalPerson?: string;
  createdPerson?: string;
  items: DocumentItemPayload[];
};

export type QuotationPayload = BaseDocumentPayload;

export type InvoicePayload = BaseDocumentPayload & {
  headerType: "INVOICE" | "INVOICE_SEND_PRODUCT" | "INVOICE_SEND_PRODUCT_TAX_INVOICE";
  dueDate: string;
};

export type ReceiptPayload = BaseDocumentPayload & {
  headerType: "RECEIPT" | "RECEIPT_TAX_INVOICE";
  dueDate: string;
};

export type CompanyResult = {
  id: string;
  name: string;
  taxIdent?: string;
  ownerName?: string;
  email?: string;
  telephone?: string;
};

export type CreateDocumentResponse = {
  message: string;
  trackingId: string;
  documentNumber: string;
};

export type DocumentJobStatus = {
  trackingId: string;
  status: "processing" | "completed" | "failed" | "pending";
  message: string;
  result?: {
    id?: string;
    pdfUrl?: string;
  } | null;
  errors?: Array<{
    code: string;
    message: string;
  }> | null;
  createdAt: string;
};

type TokenResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
};

export class AccrevoxClient {
  private readonly http: AxiosInstance;
  private accessToken?: string;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly companyApiKey: string
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 30000
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const { data } = await this.http.post<TokenResponse>("/api/v1/token", {
      clientId: this.clientId,
      clientSecret: this.clientSecret
    }, {
      headers: {
        Accept: "application/json"
      }
    });

    this.accessToken = data.accessToken;
    return data.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "x-api-key": this.companyApiKey
    };
  }

  async searchContacts(search: string): Promise<ContactSearchResult[]> {
    const headers = await this.authHeaders();
    const { data } = await this.http.get<{ data: ContactSearchResult[] }>("/api/v1/contacts", {
      headers,
      params: {
        search,
        page: 1,
        limit: 10
      }
    });

    return data.data ?? [];
  }

  async getCompany(): Promise<CompanyResult> {
    const headers = await this.authHeaders();
    const { data } = await this.http.get<CompanyResult>("/api/v1/companies", {
      headers
    });

    return data;
  }

  async searchProducts(search: string): Promise<ProductSearchResult[]> {
    const headers = await this.authHeaders();
    const { data } = await this.http.get<{ data: ProductSearchResult[] }>("/api/v1/products", {
      headers,
      params: {
        search,
        page: 1,
        limit: 10
      }
    });

    return data.data ?? [];
  }

  async createQuotation(payload: QuotationPayload): Promise<CreateDocumentResponse> {
    return this.createDocument("/api/v1/quotations", payload);
  }

  async createInvoice(payload: InvoicePayload): Promise<CreateDocumentResponse> {
    return this.createDocument("/api/v1/invoices", payload);
  }

  async createReceipt(payload: ReceiptPayload): Promise<CreateDocumentResponse> {
    return this.createDocument("/api/v1/receipts", payload);
  }

  private async createDocument(
    path: string,
    payload: QuotationPayload | InvoicePayload | ReceiptPayload
  ): Promise<CreateDocumentResponse> {
    const headers = await this.authHeaders();
    const { data } = await this.http.post<CreateDocumentResponse>(path, payload, {
      headers: {
        ...headers,
        "Content-Type": "application/json"
      }
    });

    return data;
  }

  async getDocumentJobStatus(trackingId: string): Promise<DocumentJobStatus> {
    const headers = await this.authHeaders();
    const { data } = await this.http.get<DocumentJobStatus>(`/api/v1/documents/jobs/${trackingId}`, {
      headers
    });

    return data;
  }
}
