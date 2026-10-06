import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  centsToDecimalString,
  collapseWhitespace,
  gramsToKgString,
  MAX_STOCK,
  normalizeSku,
  parseMoney,
  parseWeightKg,
  type Product,
  SKU_PATTERN,
  slugify,
} from '@stockroom/contracts';
import { useCategories } from '@/features/catalog/use-categories';
import { StockBadge } from '@/features/catalog/StockBadge';
import { api } from '@/shared/api/endpoints';
import { describeError, ProblemError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { money } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { ErrorState, Skeleton } from '@/shared/ui/feedback';
import { Field, Input, Textarea } from '@/shared/ui/field';
import { ProductArt } from '@/shared/ui/product-art';
import { Glass, PageHeader } from '@/shared/ui/surface';
import { DeleteProductDialog } from './DeleteProductDialog';

const formSchema = z.object({
  sku: z
    .string()
    .transform(normalizeSku)
    .pipe(z.string().min(1, 'SKU is required').regex(SKU_PATTERN, '2–64 letters, digits, "-" or "_"')),
  name: z
    .string()
    .transform(collapseWhitespace)
    .pipe(z.string().min(1, 'Name is required').max(200)),
  description: z.string().max(5000, 'At most 5000 characters'),
  category: z
    .string()
    .transform(collapseWhitespace)
    .pipe(z.string().min(1, 'Category is required').max(60)),
  price: z.string().superRefine((value, context) => {
    if (!parseMoney(value).ok) context.addIssue({ code: 'custom', message: 'Enter a price like 19.99' });
  }),
  stock: z
    .string()
    .regex(/^\d+$/, 'Whole number, 0 or more')
    .refine((value) => Number(value) <= MAX_STOCK, `At most ${MAX_STOCK}`),
  weightKg: z.string().superRefine((value, context) => {
    if (!parseWeightKg(value).ok) context.addIssue({ code: 'custom', message: 'Kilograms with up to 3 decimals' });
  }),
});

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

const emptyForm: FormInput = { sku: '', name: '', description: '', category: '', price: '', stock: '0', weightKg: '' };

const fromProduct = (product: Product): FormInput => ({
  sku: product.sku,
  name: product.name,
  description: product.description,
  category: product.category.name,
  price: centsToDecimalString(product.price.amountCents),
  stock: String(product.stock),
  weightKg: product.weightGrams === null ? '' : gramsToKgString(product.weightGrams),
});

const toPayload = (values: FormOutput) => {
  const price = parseMoney(values.price);
  const weight = parseWeightKg(values.weightKg);
  return {
    name: values.name,
    description: values.description,
    category: values.category,
    priceCents: price.ok ? price.value : 0,
    stock: Number(values.stock),
    weightGrams: weight.ok ? weight.value : null,
  };
};

const SERVER_FIELDS: Record<string, keyof FormInput> = {
  sku: 'sku',
  name: 'name',
  description: 'description',
  category: 'category',
  priceCents: 'price',
  stock: 'stock',
  weightGrams: 'weightKg',
};

export function ProductFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const product = useQuery({ queryKey: keys.product(id ?? ''), queryFn: () => api.product(id ?? ''), enabled: editing });
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(formSchema), defaultValues: emptyForm });

  useEffect(() => {
    if (product.data && !form.formState.isDirty) form.reset(fromProduct(product.data));
  }, [product.data, form]);

  const preview = useWatch({ control: form.control });
  const previewPrice = parseMoney(preview.price ?? '');
  const previewSku = normalizeSku(preview.sku ?? '') || 'NEW-SKU';
  const previewStock = Number(preview.stock) || 0;

  const save = useMutation({
    mutationFn: async (values: FormOutput) => {
      const payload = toPayload(values);
      if (editing && product.data) return api.updateProduct(product.data.id, product.data.version, payload);
      return api.createProduct({ sku: values.sku, ...payload });
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(keys.product(saved.id), saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.products, refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: keys.categories }),
      ]);
      toast.success(editing ? 'Changes saved' : 'Product created');
      void navigate('/admin/products');
    },
    onError: (error) => {
      if (error instanceof ProblemError) {
        if (error.code === 'VERSION_CONFLICT') {
          setConflict(true);
          return;
        }
        if (error.code === 'DUPLICATE_SKU') form.setError('sku', { message: 'This SKU is already used by another product' });
        if (error.code === 'STOCK_BELOW_RESERVED')
          form.setError('stock', { message: `Must be at least ${String(error.problem.reserved)} (reserved by open orders)` });
        for (const fieldError of error.fieldErrors) {
          const field = SERVER_FIELDS[fieldError.path];
          if (field) form.setError(field, { message: fieldError.message });
        }
      }
      toast.error(describeError(error));
    },
  });

  const reloadLatest = async () => {
    const dirty = form.getValues();
    const dirtyFields = form.formState.dirtyFields;
    const latest = await queryClient.fetchQuery({ queryKey: keys.product(id ?? ''), queryFn: () => api.product(id ?? ''), staleTime: 0 });
    const base = fromProduct(latest);
    const merged = { ...base };
    for (const key of Object.keys(dirtyFields) as (keyof FormInput)[]) merged[key] = dirty[key];
    form.reset(base);
    for (const key of Object.keys(dirtyFields) as (keyof FormInput)[]) form.setValue(key, merged[key], { shouldDirty: true });
    setConflict(false);
    toast.info('Loaded the latest version and kept your edits. Review and save again.');
  };

  if (editing && product.isLoading) return <Skeleton className="h-[480px] rounded-3xl" />;
  if (editing && (product.isError || !product.data)) return <ErrorState message={describeError(product.error)} onRetry={() => void product.refetch()} />;

  const errors = form.formState.errors;

  return (
    <div>
      <Link to="/admin/products" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> All products
      </Link>
      <PageHeader
        eyebrow="Studio"
        title={editing ? 'Edit product' : 'New product'}
        description={editing ? `Version ${product.data?.version ?? ''} · concurrent edits are detected automatically.` : 'Fill the details. The preview updates as you type.'}
        actions={
          editing && product.data ? (
            <Button variant="secondary" onClick={() => setDeleting(product.data ?? null)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : undefined
        }
      />
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
        <Glass className="grid gap-5 p-6 sm:grid-cols-2">
          <Field label="SKU" error={errors.sku?.message} hint={editing ? 'SKUs are immutable to keep imports and orders consistent.' : 'Letters, digits, - or _'}>
            {(props) => <Input {...props} disabled={editing} className="font-mono uppercase" {...form.register('sku')} />}
          </Field>
          <Field label="Category" error={errors.category?.message} hint="Pick one or type a new category">
            {(props) => <Input {...props} list="category-options" {...form.register('category')} />}
          </Field>
          <datalist id="category-options">
            {(categories.data ?? []).map((category) => (
              <option key={category.slug} value={category.name} />
            ))}
          </datalist>
          <Field label="Name" error={errors.name?.message} className="sm:col-span-2">
            {(props) => <Input {...props} {...form.register('name')} />}
          </Field>
          <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
            {(props) => <Textarea {...props} {...form.register('description')} />}
          </Field>
          <Field label="Price (USD)" error={errors.price?.message}>
            {(props) => <Input {...props} inputMode="decimal" placeholder="19.99" {...form.register('price')} />}
          </Field>
          <Field
            label="Stock"
            error={errors.stock?.message}
            hint={product.data && product.data.reserved > 0 ? `${product.data.reserved} units reserved by open orders` : undefined}
          >
            {(props) => <Input {...props} inputMode="numeric" {...form.register('stock')} />}
          </Field>
          <Field label="Weight (kg)" error={errors.weightKg?.message} hint="Optional">
            {(props) => <Input {...props} inputMode="decimal" placeholder="0.35" {...form.register('weightKg')} />}
          </Field>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <Link to="/admin/products" className="inline-flex h-10 items-center rounded-xl px-4 text-sm text-muted hover:text-fg">
              Cancel
            </Link>
            <Button type="submit" loading={save.isPending}>
              <Save className="h-4 w-4" /> {editing ? 'Save changes' : 'Create product'}
            </Button>
          </div>
        </Glass>
        <div className="space-y-3 lg:sticky lg:top-24 lg:h-fit">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Eye className="h-3.5 w-3.5 text-accent" /> Live preview
          </div>
          <Glass className="overflow-hidden">
            <ProductArt seed={previewSku} categorySlug={slugify(preview.category ?? '')} className="aspect-[4/3]" />
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium tracking-wide text-subtle uppercase">{preview.category || 'Category'}</span>
                <StockBadge available={previewStock - (product.data?.reserved ?? 0)} />
              </div>
              <div className="line-clamp-2 text-sm font-medium break-words">{collapseWhitespace(preview.name ?? '') || 'Product name'}</div>
              <div className="flex items-end justify-between">
                <span className="text-lg font-semibold tabular-nums">{previewPrice.ok ? money(previewPrice.value) : '—'}</span>
                <span className="font-mono text-[10px] text-subtle">{previewSku}</span>
              </div>
            </div>
          </Glass>
        </div>
      </form>
      <Dialog
        open={conflict}
        onOpenChange={setConflict}
        title="Someone else changed this product"
        description="Another person, an import or a purchase updated it while you were editing. Load the latest version and keep your edits?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflict(false)}>
              Cancel
            </Button>
            <Button onClick={() => void reloadLatest()}>Reload latest</Button>
          </>
        }
      />
      <DeleteProductDialog product={deleting} onClose={() => setDeleting(null)} onDeleted={() => void navigate('/admin/products')} />
    </div>
  );
}
