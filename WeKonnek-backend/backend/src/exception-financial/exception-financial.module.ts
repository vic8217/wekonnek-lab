import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExceptionFinancialController } from './exception-financial.controller';
import { ExceptionFinancialService } from './exception-financial.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExceptionFinancialController],
  providers: [ExceptionFinancialService],
  exports: [ExceptionFinancialService],
})
export class ExceptionFinancialModule {}
