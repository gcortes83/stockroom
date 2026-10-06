import { Inject, Injectable } from '@nestjs/common';
import {
  type Category,
  type CreateProduct,
  pageMeta,
  type Product,
  type ProductListResponse,
  type ProductListQuery,
  type UpdateProduct,
} from '@stockroom/contracts';
import { DATABASE, type Database, isUniqueViolation, newId } from '@stockroom/platform';
import {
  duplicateSku,
  preconditionRequired,
  productHasReservations,
  productNotFound,
  stockBelowReserved,
  versionConflict,
} from '../domain/errors';
import { ProductRepository, type ProductWrite } from '../infrastructure/product.repository';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ProductRepository) private readonly products: ProductRepository,
  ) {}

  async list(query: ProductListQuery): Promise<ProductListResponse> {
    const { items, total, match } = await this.products.search(query);
    return { data: items, page: pageMeta(query.page, query.pageSize, total), match };
  }

  async get(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw productNotFound(id);
    return product;
  }

  async create(input: CreateProduct): Promise<Product> {
    const id = newId();
    try {
      return await this.db.transaction(async (tx) => {
        const categories = await this.products.ensureCategories(tx, [input.category]);
        await this.products.insert(tx, id, input.sku, this.toWrite(input, categories));
        const created = await this.products.findById(id, tx);
        if (!created) throw productNotFound(id);
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'products_sku_key')) throw duplicateSku(input.sku);
      throw error;
    }
  }

  async update(id: string, expectedVersion: number | null, input: UpdateProduct): Promise<Product> {
    if (expectedVersion === null) throw preconditionRequired();
    return this.db.transaction(async (tx) => {
      const categories = await this.products.ensureCategories(tx, [input.category]);
      const updated = await this.products.updateIfVersion(tx, id, expectedVersion, this.toWrite(input, categories));
      if (!updated) {
        const state = await this.products.findState(tx, id);
        if (!state || state.deleted) throw productNotFound(id);
        if (state.version !== expectedVersion) throw versionConflict(state.version);
        throw stockBelowReserved(state.reserved);
      }
      const product = await this.products.findById(id, tx);
      if (!product) throw productNotFound(id);
      return product;
    });
  }

  async delete(id: string): Promise<void> {
    if (await this.products.softDelete(id)) return;
    const state = await this.products.findState(this.db, id);
    if (!state || state.deleted) throw productNotFound(id);
    throw productHasReservations(state.reserved);
  }

  categories(): Promise<Category[]> {
    return this.products.listCategories();
  }

  private toWrite(input: UpdateProduct, categories: Map<string, string>): ProductWrite {
    const categoryId = categories.get(input.category.toLowerCase());
    if (!categoryId) throw new Error(`Category ${input.category} could not be resolved`);
    return {
      name: input.name,
      description: input.description,
      categoryId,
      priceCents: input.priceCents,
      stock: input.stock,
      weightGrams: input.weightGrams,
    };
  }
}
