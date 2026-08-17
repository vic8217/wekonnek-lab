import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { FirebasePushService } from './firebase-push.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, FirebasePushService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
