import { Module } from '@nestjs/common';
import { StaffPostsService } from './staff-posts.service';
import { StaffPostsController } from './staff-posts.controller';

@Module({
  controllers: [StaffPostsController],
  providers: [StaffPostsService],
  exports: [StaffPostsService],
})
export class StaffPostsModule {}
