import {
  type Category,
  type CreatePaymentMethodInput,
  type CreateProductInput,
  type ImportIssue,
  type ImportJob,
  type IssueSeverity,
  type Order,
  type OrderStatus,
  type OrderSummary,
  type Paginated,
  type PaymentMethod,
  type PlaceOrderInput,
  type Product,
  type ProductListResponse,
  type ProductSort,
  type UpdateProductInput,
} from '@stockroom/contracts';
import { API_BASE, ProblemError, type ProblemDetails, request } from './http';

export type ProductListParams = {
  q?: string;
  category?: string[];
  minPriceCents?: number;
  maxPriceCents?: number;
  inStock?: boolean;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
};

function toSearch(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === false) continue;
    if (Array.isArray(value)) value.forEach((item) => search.append(key, String(item)));
    else search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  products: async (params: ProductListParams, signal?: AbortSignal) =>
    (await request<ProductListResponse>(`/products${toSearch(params)}`, { signal })).data,
  product: async (id: string, signal?: AbortSignal) => (await request<Product>(`/products/${id}`, { signal })).data,
  createProduct: async (input: CreateProductInput) => (await request<Product>('/products', { method: 'POST', body: input })).data,
  updateProduct: async (id: string, version: number, input: UpdateProductInput) =>
    (await request<Product>(`/products/${id}`, { method: 'PUT', body: input, headers: { 'if-match': `"${version}"` } })).data,
  deleteProduct: async (id: string) => {
    await request<void>(`/products/${id}`, { method: 'DELETE' });
  },
  categories: async () => (await request<{ data: Category[] }>('/categories')).data.data,
  imports: async (page: number) => (await request<Paginated<ImportJob>>(`/imports${toSearch({ page, pageSize: 10 })}`)).data,
  importJob: async (id: string) => (await request<ImportJob>(`/imports/${id}`)).data,
  importIssues: async (id: string, page: number, severity?: IssueSeverity) =>
    (await request<Paginated<ImportIssue>>(`/imports/${id}/issues${toSearch({ page, pageSize: 25, severity })}`)).data,
  importIssuesCsvUrl: (id: string) => `${API_BASE}/imports/${id}/issues?format=csv`,
  createPaymentMethod: async (input: CreatePaymentMethodInput) =>
    (await request<PaymentMethod>('/payments/methods', { method: 'POST', body: input })).data,
  placeOrder: async (input: PlaceOrderInput, idempotencyKey: string) =>
    (await request<Order>('/orders', { method: 'POST', body: input, headers: { 'idempotency-key': idempotencyKey } })).data,
  order: async (id: string) => (await request<Order>(`/orders/${id}`)).data,
  orders: async (page: number, status?: OrderStatus) =>
    (await request<Paginated<OrderSummary>>(`/orders${toSearch({ page, pageSize: 15, status })}`)).data,
};

export function uploadCsv(file: File, onProgress: (fraction: number) => void): Promise<ImportJob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/imports`);
    xhr.setRequestHeader('x-request-id', crypto.randomUUID());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as ImportJob);
      else
        reject(
          new ProblemError(
            body && typeof body === 'object' && 'code' in body
              ? (body as ProblemDetails)
              : { type: 'about:blank', title: 'Upload failed', status: xhr.status, code: 'HTTP_ERROR', detail: 'Upload failed' },
          ),
        );
    };
    xhr.onerror = () =>
      reject(new ProblemError({ type: 'about:blank', title: 'Network error', status: 0, code: 'NETWORK_ERROR', detail: 'Upload failed' }));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}
