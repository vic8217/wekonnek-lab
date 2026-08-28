import { Module } from '@nestjs/common';
import { DeliveryPartnersController } from './delivery-partners.controller';
import { DeliveryPartnersService } from './delivery-partners.service';
import { LalamoveClientService } from './lalamove-client.service';

@Module({
  controllers: [DeliveryPartnersController],
  providers: [DeliveryPartnersService, LalamoveClientService],
})
export class DeliveryPartnersModule {}
