import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialReconciliationController } from './financial-reconciliation.controller';
import { FinancialReconciliationService } from './financial-reconciliation.service';

/**
 * Stage13B-1 read adapters + Stage13B-2 read-only detectors +
 * Stage13B-3A read-only HTTP projection.
 * GET only. No writer-service imports.
 */
@Module({
  imports: [PrismaModule],
  controllers: [FinancialReconciliationController],
  providers: [FinancialReconciliationService],
  exports: [FinancialReconciliationService],
})
export class FinancialReconciliationModule {}
