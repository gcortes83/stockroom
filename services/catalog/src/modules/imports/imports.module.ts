import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ImportService } from './application/import.service';
import { SeedingService } from './application/seeding.service';
import { ImportRepository } from './infrastructure/import.repository';
import { ImportsController } from './interface/imports.controller';

@Module({
  imports: [ProductsModule],
  controllers: [ImportsController],
  providers: [ImportRepository, ImportService, SeedingService],
})
export class ImportsModule {}
