import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialReconciliationAdminController } from './financial-reconciliation-admin.controller';
import { FinancialReconciliationController } from './financial-reconciliation.controller';
import { FinancialReconciliationSearchService } from './financial-reconciliation-search.service';
import { FinancialReconciliationService } from './financial-reconciliation.service';

/**
 * Stage13B-1/13B-2/13B-3A read projection + Stage13B-3B admin discovery.
 * GET only. No writer-service imports.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    FinancialReconciliationController,
    FinancialReconciliationAdminController,
  ],
  providers: [
    FinancialReconciliationService,
    FinancialReconciliationSearchService,
  ],
  exports: [FinancialReconciliationService],
})
export class FinancialReconciliationModule {}
