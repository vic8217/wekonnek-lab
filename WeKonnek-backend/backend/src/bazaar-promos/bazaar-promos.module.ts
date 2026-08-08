import { Module } from '@nestjs/common';
import { BazaarPromosController } from './bazaar-promos.controller';
import { BazaarPromosService } from './bazaar-promos.service';

@Module({ controllers: [BazaarPromosController], providers: [BazaarPromosService] })
export class BazaarPromosModule {}
