import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderOperationalStateController } from './order-operational-state.controller';
import { OrderOperationalStateService } from './order-operational-state.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderOperationalStateController],
  providers: [OrderOperationalStateService],
  exports: [OrderOperationalStateService],
})
export class OrderOperationalStateModule {}
