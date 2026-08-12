import { Module } from '@nestjs/common';
import { DineInCrewController } from './dine-in-crew.controller';
import { DineInCrewService } from './dine-in-crew.service';
import { DineInSyncGateway } from './dine-in-sync.gateway';
import { DineInSyncService } from './dine-in-sync.service';
import { AuthModule } from '../modules/auth/auth.module';
@Module({ imports:[AuthModule], controllers:[DineInCrewController], providers:[DineInCrewService,DineInSyncGateway,DineInSyncService], exports:[DineInCrewService,DineInSyncService] })
export class DineInCrewModule {}
