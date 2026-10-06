import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type Order,
  ORDER_STATUSES,
  type OrderSummary,
  type Paginated,
  type PlaceOrder,
  placeOrderSchema,
  pageQuerySchema,
} from '@stockroom/contracts';
import { RequestId, ZodPipe } from '@stockroom/platform';
import { OrdersService } from '../application/orders.service';
import { idempotencyKeyInvalid, idempotencyKeyRequired } from '../domain/errors';

const listQuerySchema = pageQuerySchema.extend({ status: z.enum(ORDER_STATUSES).optional() });
const uuidParam = new ZodPipe(z.uuid('Must be a valid UUID'));

@Controller('v1/orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(202)
  async place(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodPipe(placeOrderSchema)) body: PlaceOrder,
    @RequestId() correlationId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Order> {
    if (!idempotencyKey) throw idempotencyKeyRequired();
    if (!z.uuid().safeParse(idempotencyKey).success) throw idempotencyKeyInvalid();
    const { order, replayed } = await this.orders.place(body, idempotencyKey.toLowerCase(), correlationId);
    void reply.header('location', `/v1/orders/${order.id}`);
    if (replayed) void reply.header('idempotent-replayed', 'true');
    return order;
  }

  @Get()
  list(@Query(new ZodPipe(listQuerySchema)) query: z.output<typeof listQuerySchema>): Promise<Paginated<OrderSummary>> {
    return this.orders.list(query.status, query.page, query.pageSize);
  }

  @Get(':id')
  get(@Param('id', uuidParam) id: string): Promise<Order> {
    return this.orders.get(id);
  }
}
