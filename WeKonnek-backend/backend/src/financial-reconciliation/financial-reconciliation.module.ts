import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialReconciliationService } from './financial-reconciliation.service';

/**
 * Stage13B-1 read adapters + Stage13B-2 read-only detectors.
 * No controllers. No routes. No writer-service imports.
 */
@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [FinancialReconciliationService],
  exports: [FinancialReconciliationService],
})
export class FinancialReconciliationModule {}
