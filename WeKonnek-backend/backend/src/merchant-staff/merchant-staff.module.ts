import { Module } from '@nestjs/common';
import { MerchantStaffService } from './merchant-staff.service';
import { MerchantStaffController } from './merchant-staff.controller';

@Module({
  controllers: [MerchantStaffController],
  providers: [MerchantStaffService],
  exports: [MerchantStaffService],
})
export class MerchantStaffModule {}
