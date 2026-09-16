import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReturnHandoffController } from './return-handoff.controller';
import { ReturnHandoffService } from './return-handoff.service';

@Module({
  imports: [PrismaModule, FulfillmentModule, AgreementsModule],
  controllers: [ReturnHandoffController],
  providers: [ReturnHandoffService],
  exports: [ReturnHandoffService],
})
export class ReturnHandoffModule {}
