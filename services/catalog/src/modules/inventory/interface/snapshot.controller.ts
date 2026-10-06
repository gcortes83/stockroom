import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import type { ProductSnapshot } from '@stockroom/contracts';
import { ZodPipe } from '@stockroom/platform';
import { ProductRepository } from '../../products/infrastructure/product.repository';

const idsSchema = z
  .string()
  .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
  .pipe(z.array(z.uuid()).min(1).max(50));

@Controller('internal/v1/products')
export class SnapshotController {
  constructor(@Inject(ProductRepository) private readonly products: ProductRepository) {}

  @Get('snapshot')
  async snapshot(@Query('ids', new ZodPipe(idsSchema)) ids: string[]): Promise<{ data: ProductSnapshot[] }> {
    return { data: await this.products.snapshot(ids) };
  }
}
