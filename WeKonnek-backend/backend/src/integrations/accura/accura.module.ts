import { Module } from '@nestjs/common';
import { AccuraClientService } from './accura-client.service';
import { AccuraIssuanceAdminController } from './accura-issuance.admin.controller';
import { AccuraIssuanceAdminService } from './accura-issuance.admin.service';
import { AccuraIssuanceJobsService } from './accura-issuance-jobs.service';
import { AccuraIssuanceProcessorService } from './accura-issuance.processor';
import { AccuraMerchantAdminController } from './accura-merchant-admin.controller';
import { AccuraMerchantAdminService } from './accura-merchant-admin.service';
import { AccuraOnboardingController } from './accura-onboarding.controller';
import { AccuraOnboardingService } from './accura-onboarding.service';
import { AccuraWebhooksController } from './accura-webhooks.controller';
import { AccuraWebhooksService } from './accura-webhooks.service';
import { ACCURA_ISSUANCE_CLOCK } from './accura-issuance.types';

@Module({
  controllers: [
    AccuraWebhooksController,
    AccuraIssuanceAdminController,
    AccuraMerchantAdminController,
    AccuraOnboardingController,
  ],
  providers: [
    AccuraClientService,
    AccuraWebhooksService,
    AccuraIssuanceJobsService,
    AccuraIssuanceAdminService,
    AccuraMerchantAdminService,
    AccuraIssuanceProcessorService,
    AccuraOnboardingService,
    { provide: ACCURA_ISSUANCE_CLOCK, useValue: () => new Date() },
  ],
  exports: [
    AccuraClientService,
    AccuraWebhooksService,
    AccuraIssuanceJobsService,
    AccuraIssuanceProcessorService,
    AccuraOnboardingService,
  ],
})
export class AccuraModule {}
