import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RiderCustodyHandoffController } from './rider-custody-handoff.controller';
import { RiderCustodyHandoffService } from './rider-custody-handoff.service';

@Module({
  imports: [PrismaModule, FulfillmentModule, AgreementsModule],
  controllers: [RiderCustodyHandoffController],
  providers: [RiderCustodyHandoffService],
  exports: [RiderCustodyHandoffService],
})
export class RiderCustodyHandoffModule {}
