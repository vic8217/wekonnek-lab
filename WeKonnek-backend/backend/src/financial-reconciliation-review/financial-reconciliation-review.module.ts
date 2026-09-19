import { Module } from '@nestjs/common';
import { FinancialReconciliationModule } from '../financial-reconciliation/financial-reconciliation.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinancialReconciliationReviewController } from './financial-reconciliation-review.controller';
import { FinancialReconciliationReviewService } from './financial-reconciliation-review.service';

@Module({
  imports: [PrismaModule, FinancialReconciliationModule],
  controllers: [FinancialReconciliationReviewController],
  providers: [FinancialReconciliationReviewService],
})
export class FinancialReconciliationReviewModule {}
