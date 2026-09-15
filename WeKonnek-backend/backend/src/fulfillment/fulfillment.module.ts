import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RiderAdvanceModule } from '../rider-advance/rider-advance.module';
import { FulfillmentService } from './fulfillment.service';
import { FulfillmentTransitionService } from './fulfillment-transition.service';
import { OrderDomainEventService } from './order-domain-event.service';
import { RiderAssignmentService } from './rider-assignment.service';
import { AuthActorService } from './auth-actor.service';

@Module({
  imports: [PrismaModule, forwardRef(() => RiderAdvanceModule)],
  providers: [
    OrderDomainEventService,
    RiderAssignmentService,
    FulfillmentTransitionService,
    FulfillmentService,
    AuthActorService,
  ],
  exports: [
    OrderDomainEventService,
    RiderAssignmentService,
    FulfillmentTransitionService,
    FulfillmentService,
    AuthActorService,
  ],
})
export class FulfillmentModule {}
