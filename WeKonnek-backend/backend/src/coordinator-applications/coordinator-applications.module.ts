import { Module } from '@nestjs/common';
import { CoordinatorApplicationsController } from './coordinator-applications.controller';
import { CoordinatorApplicationsService } from './coordinator-applications.service';

@Module({ controllers: [CoordinatorApplicationsController], providers: [CoordinatorApplicationsService] })
export class CoordinatorApplicationsModule {}
