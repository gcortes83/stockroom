import type { OrderStatus } from '@stockroom/contracts';
import type { ProductListParams } from './endpoints';

export const keys = {
  products: ['products'] as const,
  productList: (params: ProductListParams) => ['products', 'list', params] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  categories: ['categories'] as const,
  imports: ['imports'] as const,
  importList: (page: number) => ['imports', 'list', page] as const,
  importJob: (id: string) => ['imports', 'detail', id] as const,
  importIssues: (id: string, page: number, severity?: string) => ['imports', 'issues', id, page, severity] as const,
  orders: ['orders'] as const,
  orderList: (page: number, status?: OrderStatus) => ['orders', 'list', page, status] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
};
