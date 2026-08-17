import { Module } from '@nestjs/common';
import { MerchantApplicationsService } from './merchant-applications.service';
import { MerchantApplicationsController } from './merchant-applications.controller';
import { NotificationsModule } from '../modules/notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [MerchantApplicationsController],
  providers: [MerchantApplicationsService],
  exports: [MerchantApplicationsService],
})
export class MerchantApplicationsModule {}
