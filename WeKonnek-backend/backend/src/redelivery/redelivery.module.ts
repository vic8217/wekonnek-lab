import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedeliveryController } from './redelivery.controller';
import { RedeliveryService } from './redelivery.service';

@Module({
  imports: [PrismaModule, FulfillmentModule],
  controllers: [RedeliveryController],
  providers: [RedeliveryService],
  exports: [RedeliveryService],
})
export class RedeliveryModule {}
