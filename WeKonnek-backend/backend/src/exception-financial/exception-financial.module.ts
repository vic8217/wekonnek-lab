import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExceptionFinancialController } from './exception-financial.controller';
import { ExceptionFinancialService } from './exception-financial.service';
import { ExceptionFinancialSettlementController } from './exception-financial-settlement.controller';
import { ExceptionFinancialSettlementService } from './exception-financial-settlement.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    ExceptionFinancialController,
    ExceptionFinancialSettlementController,
  ],
  providers: [ExceptionFinancialService, ExceptionFinancialSettlementService],
  exports: [ExceptionFinancialService, ExceptionFinancialSettlementService],
})
export class ExceptionFinancialModule {}
