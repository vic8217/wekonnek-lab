import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OperationsRecoveryController } from './operations-recovery.controller';
import { OperationsRecoveryService } from './operations-recovery.service';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsRecoveryController],
  providers: [OperationsRecoveryService],
  exports: [OperationsRecoveryService],
})
export class OperationsRecoveryModule {}
