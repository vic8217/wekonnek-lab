import { Module } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { MerchantsController } from './merchants.controller';
import { CoordinatorApplicationsModule } from '../coordinator-applications/coordinator-applications.module';

@Module({
  imports: [CoordinatorApplicationsModule],
  controllers: [MerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
