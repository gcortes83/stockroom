import { Module } from '@nestjs/common';
import { ProductsService } from './application/products.service';
import { ProductRepository } from './infrastructure/product.repository';
import { CategoriesController, ProductsController } from './interface/products.controller';

@Module({
  controllers: [ProductsController, CategoriesController],
  providers: [ProductRepository, ProductsService],
  exports: [ProductRepository],
})
export class ProductsModule {}
