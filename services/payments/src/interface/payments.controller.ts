import { Body, Controller, Inject, Injectable, type OnApplicationBootstrap, Post } from '@nestjs/common';
import type { z } from 'zod';
import { createPaymentMethodSchema, EventTypes, type PaymentMethod } from '@stockroom/contracts';
import { BROKER, type Broker, ZodPipe } from '@stockroom/platform';
import { PAYMENTS_QUEUE, PaymentsService } from '../application/payments.service';

@Controller('v1/payments/methods')
export class PaymentMethodsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post()
  create(@Body(new ZodPipe(createPaymentMethodSchema)) body: z.output<typeof createPaymentMethodSchema>): Promise<PaymentMethod> {
    return this.payments.tokenize(body);
  }
}

@Injectable()
export class PaymentsConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(BROKER) private readonly broker: Broker,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  onApplicationBootstrap(): void {
    this.broker.consume({ name: PAYMENTS_QUEUE, bindings: [EventTypes.ChargeRequested, EventTypes.RefundRequested] }, async (event) => {
      if (event.type === EventTypes.ChargeRequested) await this.payments.charge(event);
      else if (event.type === EventTypes.RefundRequested) await this.payments.refund(event);
    });
  }
}
