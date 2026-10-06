import { useRef } from 'react';
import { Link, useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { CreditCard, FlaskConical, Lock, ShieldCheck, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { TEST_CARDS } from '@stockroom/contracts';
import { cart, cartSignature, cartTotals, useCart } from '@/features/cart/cart-store';
import { api } from '@/shared/api/endpoints';
import { describeError, ProblemError } from '@/shared/api/http';
import { money } from '@/shared/lib/format';
import { Button, buttonStyles } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/feedback';
import { Field, Input } from '@/shared/ui/field';
import { ProductArt } from '@/shared/ui/product-art';
import { Glass, PageHeader } from '@/shared/ui/surface';

const checkoutSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().pipe(z.email('Enter a valid email')),
  cardNumber: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{13,19}$/, 'Enter a 13–19 digit card number')),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/, 'Use MM/YY'),
  cvc: z.string().regex(/^\d{3,4}$/, '3 or 4 digits'),
});

type CheckoutForm = z.input<typeof checkoutSchema>;
type CheckoutValues = z.output<typeof checkoutSchema>;
type FieldName = keyof CheckoutForm;

const FIELD_FROM_SERVER: Record<string, FieldName> = {
  'customer.name': 'name',
  'customer.email': 'email',
  cardNumber: 'cardNumber',
  expMonth: 'expiry',
  expYear: 'expiry',
  cvc: 'cvc',
  holderName: 'name',
};

const formatCard = (value: string) =>
  value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');

const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
};

type Attempt = { fingerprint: string; paymentMethodId: string; idempotencyKey: string };

export function CheckoutPage() {
  const lines = useCart();
  const navigate = useNavigate();
  const attempt = useRef<Attempt | null>(null);
  const { subtotalCents, itemCount } = cartTotals(lines);
  const form = useForm<CheckoutForm, unknown, CheckoutValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: { name: '', email: '', cardNumber: '', expiry: '', cvc: '' },
  });

  const placeOrder = useMutation({
    mutationFn: async (values: CheckoutValues) => {
      const fingerprint = [cartSignature(lines), values.name, values.email, values.cardNumber, values.expiry, values.cvc].join('#');
      if (attempt.current?.fingerprint !== fingerprint) {
        const [month = '1', year = '0'] = values.expiry.split('/').map((part) => part.trim());
        const method = await api.createPaymentMethod({
          cardNumber: values.cardNumber,
          expMonth: Number(month),
          expYear: 2000 + Number(year),
          cvc: values.cvc,
          holderName: values.name,
        });
        attempt.current = { fingerprint, paymentMethodId: method.id, idempotencyKey: crypto.randomUUID() };
      }
      const current = attempt.current;
      return api.placeOrder(
        {
          customer: { name: values.name, email: values.email },
          lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
          paymentMethodId: current.paymentMethodId,
          expectedTotalCents: subtotalCents,
        },
        current.idempotencyKey,
      );
    },
    onSuccess: (order) => {
      void navigate(`/shop/orders/${order.id}`);
    },
    onError: (error) => {
      if (!(error instanceof ProblemError)) {
        toast.error(describeError(error));
        return;
      }
      const problem = error.problem;
      if (error.code === 'VALIDATION') {
        for (const fieldError of error.fieldErrors) {
          const field = FIELD_FROM_SERVER[fieldError.path];
          if (field) form.setError(field, { message: fieldError.message });
        }
        attempt.current = null;
        toast.error(problem.detail ?? 'Please check the highlighted fields.');
      } else if (error.code === 'PRICE_CHANGED') {
        const updated = (problem.lines as { productId: string; unitPriceCents: number }[] | undefined) ?? [];
        cart.applyPrices(updated);
        toast.warning('Some prices changed. Review the new total and place the order again.');
      } else if (error.code === 'INSUFFICIENT_STOCK' || error.code === 'PRODUCT_UNAVAILABLE') {
        toast.error(problem.detail ?? 'Some items are no longer available.', {
          action: { label: 'Review cart', onClick: () => void navigate('/shop/cart') },
        });
      } else {
        toast.error(problem.detail ?? 'Could not place the order.');
      }
    },
  });

  if (lines.length === 0)
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Nothing to check out"
          description="Add products to your cart first."
          action={
            <Link to="/shop" className={buttonStyles('primary', 'sm')}>
              Discover products
            </Link>
          }
        />
      </div>
    );

  const errors = form.formState.errors;

  return (
    <div>
      <PageHeader eyebrow="Checkout" title="Almost yours" description="Payments are simulated. No real card is charged and card numbers never leave the payments service." />
      <form onSubmit={form.handleSubmit((values) => placeOrder.mutate(values))} className="grid gap-6 lg:grid-cols-[1fr_380px]" noValidate>
        <div className="space-y-6">
          <Glass className="space-y-5 p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4 text-accent" /> Contact
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" error={errors.name?.message}>
                {(props) => <Input {...props} autoComplete="name" {...form.register('name')} />}
              </Field>
              <Field label="Email" error={errors.email?.message}>
                {(props) => <Input {...props} type="email" autoComplete="email" {...form.register('email')} />}
              </Field>
            </div>
          </Glass>
          <Glass className="space-y-5 p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <CreditCard className="h-4 w-4 text-accent" /> Payment
            </h2>
            <Field label="Card number" error={errors.cardNumber?.message}>
              {(props) => (
                <Controller
                  control={form.control}
                  name="cardNumber"
                  render={({ field }) => (
                    <Input
                      {...props}
                      {...field}
                      onChange={(event) => field.onChange(formatCard(event.target.value))}
                      inputMode="numeric"
                      autoComplete="cc-number"
                      placeholder="4242 4242 4242 4242"
                      className="font-mono tracking-wider"
                    />
                  )}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Expiry" error={errors.expiry?.message}>
                {(props) => (
                  <Controller
                    control={form.control}
                    name="expiry"
                    render={({ field }) => (
                      <Input
                        {...props}
                        {...field}
                        onChange={(event) => field.onChange(formatExpiry(event.target.value))}
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        placeholder="MM/YY"
                      />
                    )}
                  />
                )}
              </Field>
              <Field label="CVC" error={errors.cvc?.message}>
                {(props) => <Input {...props} inputMode="numeric" autoComplete="cc-csc" maxLength={4} placeholder="123" {...form.register('cvc')} />}
              </Field>
            </div>
            <div className="rounded-2xl border border-dashed border-accent/30 bg-accent/5 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-accent">
                <FlaskConical className="h-3.5 w-3.5" /> Test cards — click to fill
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {TEST_CARDS.map((card) => (
                  <button
                    key={card.number}
                    type="button"
                    onClick={() => {
                      form.setValue('cardNumber', formatCard(card.number), { shouldValidate: true });
                      form.setValue('expiry', '12/30', { shouldValidate: true });
                      form.setValue('cvc', '123', { shouldValidate: true });
                    }}
                    className="glass rounded-xl px-3 py-2 text-left transition-colors hover:border-accent/40"
                  >
                    <div className="font-mono text-xs">{formatCard(card.number)}</div>
                    <div className="text-[11px] text-muted">{card.label}</div>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-subtle">Any other valid card number is approved. Orders above $10,000 are declined.</p>
            </div>
          </Glass>
        </div>
        <Glass className="h-fit space-y-4 p-6 lg:sticky lg:top-24">
          <h2 className="font-semibold">
            Order summary <span className="text-sm font-normal text-muted">· {itemCount} items</span>
          </h2>
          <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
            {lines.map((line) => (
              <div key={line.productId} className="flex items-center gap-3">
                <ProductArt seed={line.sku} categorySlug={line.categorySlug} className="h-11 w-11 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{line.name}</div>
                  <div className="text-xs text-muted">Qty {line.quantity}</div>
                </div>
                <div className="text-sm tabular-nums">{money(line.unitPriceCents * line.quantity)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-end justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">Total</span>
            <span className="text-2xl font-semibold tabular-nums">{money(subtotalCents)}</span>
          </div>
          <Button type="submit" size="lg" className="w-full" loading={placeOrder.isPending}>
            <Lock className="h-4 w-4" /> Place order
          </Button>
          <p className="text-center text-[11px] text-subtle">Protected against double submission with an idempotency key.</p>
        </Glass>
      </form>
    </div>
  );
}
