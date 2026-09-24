import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { RiderAssignmentsController } from './rider-assignments.controller';
import { RiderAssignmentsService } from './rider-assignments.service';

@Module({
  imports: [PrismaModule, FulfillmentModule],
  controllers: [RiderAssignmentsController],
  providers: [RiderAssignmentsService],
})
export class RiderAssignmentsModule {}
