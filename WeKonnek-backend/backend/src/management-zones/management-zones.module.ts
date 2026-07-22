import { Module } from '@nestjs/common';
import { ManagementZonesController } from './management-zones.controller';
import { ManagementZonesService } from './management-zones.service';

@Module({ controllers: [ManagementZonesController], providers: [ManagementZonesService] })
export class ManagementZonesModule {}
