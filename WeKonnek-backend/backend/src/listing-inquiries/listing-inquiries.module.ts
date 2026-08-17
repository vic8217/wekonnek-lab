import { Module } from '@nestjs/common';
import { ListingInquiriesController } from './listing-inquiries.controller';
import { ListingInquiriesService } from './listing-inquiries.service';
import { NotificationsModule } from '../modules/notifications/notifications.module';

@Module({ imports: [NotificationsModule], controllers: [ListingInquiriesController], providers: [ListingInquiriesService] })
export class ListingInquiriesModule {}
