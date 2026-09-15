import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AgreementService } from './agreement.service';
import { AgreementEvidenceService } from './agreement-evidence.service';
import { CustodyEventService } from './custody-event.service';
import { AgreementsController } from './agreements.controller';

@Module({
  imports: [PrismaModule, FulfillmentModule],
  controllers: [AgreementsController],
  providers: [AgreementService, AgreementEvidenceService, CustodyEventService],
  exports: [AgreementService, AgreementEvidenceService, CustodyEventService],
})
export class AgreementsModule {}
