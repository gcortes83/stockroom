import { motion } from 'motion/react';
import { Check, CircleDashed, Loader2, MinusCircle, X } from 'lucide-react';
import type { Order } from '@stockroom/contracts';
import { cn } from '@/shared/lib/cn';
import { time } from '@/shared/lib/format';
import { pipeline, STATUS_LABEL } from './order-meta';

export function OrderPipeline({ order }: { order: Order }) {
  const steps = pipeline(order);
  return (
    <ol className="space-y-1" aria-label="Order progress">
      {steps.map((step, index) => (
        <motion.li
          key={step.key}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.06 }}
          className="relative flex gap-4 pb-6 last:pb-0"
        >
          {index < steps.length - 1 && (
            <span
              className={cn(
                'absolute top-10 left-[19px] h-[calc(100%-2.5rem)] w-px',
                step.state === 'done' ? 'bg-gradient-to-b from-accent to-accent-2' : 'bg-line',
              )}
              aria-hidden
            />
          )}
          <span
            className={cn(
              'relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl border',
              step.state === 'done' && 'bg-ai border-transparent text-white',
              step.state === 'active' && 'pulse-ring border-accent/50 bg-accent/15 text-accent',
              step.state === 'pending' && 'border-line text-subtle',
              step.state === 'failed' && 'border-danger/40 bg-danger/15 text-danger',
              step.state === 'skipped' && 'border-line text-subtle',
            )}
          >
            {step.state === 'done' && <Check className="h-4 w-4" />}
            {step.state === 'active' && <Loader2 className="h-4 w-4 animate-spin" />}
            {step.state === 'pending' && <CircleDashed className="h-4 w-4" />}
            {step.state === 'failed' && <X className="h-4 w-4" />}
            {step.state === 'skipped' && <MinusCircle className="h-4 w-4" />}
          </span>
          <div className="pt-1.5">
            <div className={cn('font-medium', step.state === 'active' && 'shimmer-text', step.state === 'pending' && 'text-subtle')}>{step.title}</div>
            <div className="text-xs text-muted">{step.caption}</div>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

export function OrderTrace({ order }: { order: Order }) {
  return (
    <div className="rounded-2xl border border-line bg-black/20 p-4 font-mono text-[11px] leading-6 text-muted">
      {order.history.map((entry, index) => (
        <motion.div key={`${entry.to}-${index}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.08 }}>
          <span className="text-subtle">{time(entry.at)}</span> <span className="text-accent">›</span>{' '}
          {entry.from ? `${STATUS_LABEL[entry.from]} → ` : ''}
          <span className="text-fg">{STATUS_LABEL[entry.to]}</span>
          {entry.reason && <span className="text-danger"> ({entry.reason})</span>}
        </motion.div>
      ))}
    </div>
  );
}
