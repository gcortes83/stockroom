import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Receipt } from 'lucide-react';
import { ORDER_STATUSES, type OrderStatus } from '@stockroom/contracts';
import { api } from '@/shared/api/endpoints';
import { describeError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { cn } from '@/shared/lib/cn';
import { dateTime, money, relative } from '@/shared/lib/format';
import { EmptyState, ErrorState, Skeleton } from '@/shared/ui/feedback';
import { Pagination } from '@/shared/ui/pagination';
import { Badge, Glass, PageHeader } from '@/shared/ui/surface';
import { cancellationMessage, STATUS_LABEL, STATUS_TONE } from './order-meta';
import { OrderPipeline, OrderTrace } from './OrderPipeline';

export function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const orders = useQuery({
    queryKey: keys.orderList(page, status),
    queryFn: () => api.orders(page, status),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });

  return (
    <div>
      <PageHeader eyebrow="Studio" title="Orders" description="Every order and where it is in the checkout saga. Refreshes automatically." />
      <div className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-surface-2 p-1 sm:w-fit" role="tablist">
        {([undefined, ...ORDER_STATUSES] as const).map((value) => (
          <button
            key={value ?? 'all'}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={cn('rounded-xl px-3 py-1.5 text-xs transition-colors', status === value ? 'bg-bg text-fg shadow' : 'text-muted hover:text-fg')}
          >
            {value ? STATUS_LABEL[value] : 'All'}
          </button>
        ))}
      </div>
      {orders.isError ? (
        <ErrorState message={describeError(orders.error)} onRetry={() => void orders.refetch()} />
      ) : orders.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : orders.data?.data.length === 0 ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="No orders yet" description="Orders placed in Discover show up here." />
      ) : (
        <Glass className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] tracking-wide text-subtle uppercase">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 text-right font-medium">Items</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody>
                {orders.data?.data.map((order) => (
                  <tr key={order.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <Link to={`/admin/orders/${order.id}`} className="font-mono text-xs hover:text-accent">
                        {order.id.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{order.customerEmail}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{order.lineCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(order.total.amountCents, order.total.currency)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{relative(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Glass>
      )}
      {orders.data && <Pagination page={orders.data.page} onChange={setPage} />}
    </div>
  );
}

export function AdminOrderDetailPage() {
  const { id = '' } = useParams();
  const order = useQuery({ queryKey: keys.order(id), queryFn: () => api.order(id), refetchInterval: 4000 });
  if (order.isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (order.isError || !order.data) return <ErrorState message={describeError(order.error)} onRetry={() => void order.refetch()} />;
  const data = order.data;
  const reason = cancellationMessage(data);
  return (
    <div>
      <Link to="/admin/orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> All orders
      </Link>
      <PageHeader
        eyebrow="Order"
        title={<span className="font-mono text-2xl break-all">{data.id}</span>}
        description={`${data.customer.name} · ${data.customer.email} · ${dateTime(data.createdAt)}`}
        actions={<Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <Glass className="space-y-6 p-6">
          <OrderPipeline order={data} />
          <OrderTrace order={data} />
        </Glass>
        <div className="space-y-4">
          {reason && <Glass className="border-danger/30 p-5 text-sm text-muted">{reason}</Glass>}
          <Glass className="space-y-3 p-5">
            {data.lines.map((line) => (
              <div key={line.productId} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {line.quantity} × {line.name} <span className="font-mono text-[11px] text-subtle">{line.sku}</span>
                </span>
                <span className="tabular-nums">{money(line.lineTotal.amountCents)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-3 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(data.total.amountCents)}</span>
            </div>
            <div className="text-xs text-muted">
              Payment: {data.payment ? `${data.payment.status.toLowerCase()}${data.payment.last4 ? ` · •••• ${data.payment.last4}` : ''}${data.payment.declineReason ? ` · ${data.payment.declineReason}` : ''}` : 'not attempted'}
            </div>
          </Glass>
        </div>
      </div>
    </div>
  );
}
