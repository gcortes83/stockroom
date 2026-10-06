import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { CheckCircle2, CreditCard, RefreshCw, XCircle } from 'lucide-react';
import { TERMINAL_ORDER_STATUSES } from '@stockroom/contracts';
import { cart } from '@/features/cart/cart-store';
import { api } from '@/shared/api/endpoints';
import { describeError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { money } from '@/shared/lib/format';
import { Button, buttonStyles } from '@/shared/ui/button';
import { ErrorState, Skeleton } from '@/shared/ui/feedback';
import { Badge, Glass } from '@/shared/ui/surface';
import { cancellationMessage, STATUS_LABEL, STATUS_TONE } from './order-meta';
import { OrderPipeline, OrderTrace } from './OrderPipeline';

const POLL_TIMEOUT_MS = 60_000;

export function OrderStatusPage() {
  const { id = '' } = useParams();
  const startedAt = useRef(Date.now());
  const clearedFor = useRef<string | null>(null);
  const order = useQuery({
    queryKey: keys.order(id),
    queryFn: () => api.order(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_ORDER_STATUSES.includes(status)) return false;
      const elapsed = Date.now() - startedAt.current;
      if (elapsed > POLL_TIMEOUT_MS) return false;
      return elapsed > 10_000 ? 3000 : 1000;
    },
  });

  useEffect(() => {
    if (order.data?.status === 'CONFIRMED' && clearedFor.current !== order.data.id) {
      clearedFor.current = order.data.id;
      cart.clear();
    }
  }, [order.data?.status, order.data?.id]);

  if (order.isLoading) return <Skeleton className="mx-auto h-96 max-w-3xl rounded-3xl" />;
  if (order.isError || !order.data) return <ErrorState message={describeError(order.error)} onRetry={() => void order.refetch()} />;

  const data = order.data;
  const terminal = TERMINAL_ORDER_STATUSES.includes(data.status);
  const timedOut = !terminal && Date.now() - startedAt.current > POLL_TIMEOUT_MS;
  const reason = cancellationMessage(data);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 text-center">
        <Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {data.status === 'CONFIRMED' ? (
            <>
              Order <span className="text-gradient">confirmed</span>
            </>
          ) : data.status === 'CANCELLED' ? (
            'Order cancelled'
          ) : (
            <span className="shimmer-text">Working on your order…</span>
          )}
        </h1>
        <p className="font-mono text-xs text-subtle">#{data.id}</p>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
        <Glass className="space-y-6 p-6">
          <OrderPipeline order={data} />
          <OrderTrace order={data} />
          {timedOut && (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-warning/10 p-3 text-xs text-warning">
              Still processing. This can take a moment if a service is restarting.
              <Button size="sm" variant="secondary" onClick={() => void order.refetch()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
          )}
        </Glass>
        <div className="space-y-4">
          {data.status === 'CONFIRMED' && (
            <Glass className="glow flex items-start gap-3 p-5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div className="space-y-1 text-sm">
                <div className="font-medium">Thanks, {data.customer.name}!</div>
                <div className="text-muted">A confirmation would be sent to {data.customer.email} in a real store.</div>
              </div>
            </Glass>
          )}
          {data.status === 'CANCELLED' && reason && (
            <Glass className="flex items-start gap-3 border-danger/30 p-5">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              <div className="space-y-3 text-sm">
                <p className="text-muted">{reason}</p>
                <Link to="/shop/cart" className={buttonStyles('secondary', 'sm')}>
                  Back to cart
                </Link>
              </div>
            </Glass>
          )}
          <Glass className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Items</h2>
            {data.lines.map((line) => (
              <div key={line.productId} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-muted">
                  {line.quantity} × {line.name}
                </span>
                <span className="tabular-nums">{money(line.lineTotal.amountCents, line.lineTotal.currency)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-3 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(data.total.amountCents, data.total.currency)}</span>
            </div>
            {data.payment?.last4 && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <CreditCard className="h-3.5 w-3.5" /> Card •••• {data.payment.last4} · {data.payment.status.toLowerCase()}
              </div>
            )}
          </Glass>
          <Link to="/shop" className={buttonStyles('ghost', 'sm', 'w-full')}>
            Continue discovering
          </Link>
        </div>
      </div>
    </div>
  );
}
