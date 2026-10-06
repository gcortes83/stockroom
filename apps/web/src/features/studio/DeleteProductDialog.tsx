import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Product } from '@stockroom/contracts';
import { api } from '@/shared/api/endpoints';
import { describeError } from '@/shared/api/http';
import { keys } from '@/shared/api/keys';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';

export function DeleteProductDialog({
  product,
  onClose,
  onDeleted,
}: {
  product: Product | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProduct(id),
    onSuccess: async (_, id) => {
      queryClient.removeQueries({ queryKey: keys.product(id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.products }),
        queryClient.invalidateQueries({ queryKey: keys.categories }),
      ]);
      toast.success('Product deleted');
      onClose();
      onDeleted?.();
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <Dialog
      open={product !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Delete product?"
      description={
        product ? (
          <>
            <span className="font-medium text-fg">{product.name}</span> ({product.sku}) will disappear from the catalog and search. Past orders keep
            their copy.
          </>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => product && remove.mutate(product.id)}>
            Delete
          </Button>
        </>
      }
    />
  );
}
