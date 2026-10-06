import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type Category,
  type CreateProduct,
  createProductSchema,
  type Product,
  type ProductListResponse,
  type ProductListQuery,
  productListQuerySchema,
  type UpdateProduct,
  updateProductSchema,
} from '@stockroom/contracts';
import { ZodPipe } from '@stockroom/platform';
import { ProductsService } from '../application/products.service';
import { parseIfMatch } from '../domain/errors';

export const uuidParam = new ZodPipe(z.uuid('Must be a valid UUID'));

@Controller('v1/products')
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get()
  list(@Query(new ZodPipe(productListQuerySchema)) query: ProductListQuery): Promise<ProductListResponse> {
    return this.products.list(query);
  }

  @Get(':id')
  async get(@Param('id', uuidParam) id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<Product> {
    const product = await this.products.get(id);
    void reply.header('etag', `"${product.version}"`);
    return product;
  }

  @Post()
  async create(
    @Body(new ZodPipe(createProductSchema)) body: CreateProduct,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Product> {
    const product = await this.products.create(body);
    void reply.header('location', `/v1/products/${product.id}`).header('etag', `"${product.version}"`);
    return product;
  }

  @Put(':id')
  async update(
    @Param('id', uuidParam) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodPipe(updateProductSchema)) body: UpdateProduct,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Product> {
    const product = await this.products.update(id, parseIfMatch(ifMatch), body);
    void reply.header('etag', `"${product.version}"`);
    return product;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', uuidParam) id: string): Promise<void> {
    await this.products.delete(id);
  }
}

@Controller('v1/categories')
export class CategoriesController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get()
  async list(): Promise<{ data: Category[] }> {
    return { data: await this.products.categories() };
  }
}
