import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { InventoryService } from './application/inventory.service';
import { InventoryConsumer } from './interface/inventory.consumer';
import { SnapshotController } from './interface/snapshot.controller';

@Module({
  imports: [ProductsModule],
  controllers: [SnapshotController],
  providers: [InventoryService, InventoryConsumer],
  exports: [InventoryService],
})
export class InventoryModule {}
