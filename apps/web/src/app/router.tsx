import { createBrowserRouter, Navigate } from 'react-router';
import { ProductDetailPage } from '@/features/catalog/ProductDetailPage';
import { ShopPage } from '@/features/catalog/ShopPage';
import { AppShell } from './AppShell';
import { RouteError } from './RouteError';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/shop" replace /> },
      { path: 'shop', element: <ShopPage />, errorElement: <RouteError /> },
      { path: 'shop/products/:id', element: <ProductDetailPage />, errorElement: <RouteError /> },
      {
        path: 'shop/cart',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/cart/CartPage')).CartPage }),
      },
      {
        path: 'shop/checkout',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/checkout/CheckoutPage')).CheckoutPage }),
      },
      {
        path: 'shop/orders/:id',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/orders/OrderStatusPage')).OrderStatusPage }),
      },
      { path: 'admin', element: <Navigate to="/admin/products" replace /> },
      {
        path: 'admin/products',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/studio/AdminProductsPage')).AdminProductsPage }),
      },
      {
        path: 'admin/products/new',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/studio/ProductFormPage')).ProductFormPage }),
      },
      {
        path: 'admin/products/:id/edit',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/studio/ProductFormPage')).ProductFormPage }),
      },
      {
        path: 'admin/imports',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/imports/ImportsPage')).ImportsPage }),
      },
      {
        path: 'admin/imports/:id',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/imports/ImportReportPage')).ImportReportPage }),
      },
      {
        path: 'admin/orders',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/orders/AdminOrdersPage')).AdminOrdersPage }),
      },
      {
        path: 'admin/orders/:id',
        errorElement: <RouteError />,
        lazy: async () => ({ Component: (await import('@/features/orders/AdminOrdersPage')).AdminOrderDetailPage }),
      },
      { path: '*', element: <RouteError /> },
    ],
  },
]);
