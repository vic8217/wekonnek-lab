import { Module } from '@nestjs/common';
import { CoordinatorApplicationsController } from './coordinator-applications.controller';
import { CoordinatorApplicationsService } from './coordinator-applications.service';
import { NotificationsModule } from '../modules/notifications/notifications.module';

@Module({ imports: [NotificationsModule], controllers: [CoordinatorApplicationsController], providers: [CoordinatorApplicationsService], exports: [CoordinatorApplicationsService] })
export class CoordinatorApplicationsModule {}
