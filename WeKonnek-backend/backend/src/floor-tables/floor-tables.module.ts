import { Module } from '@nestjs/common';
import { FloorTablesService } from './floor-tables.service';
import { FloorTablesController } from './floor-tables.controller';

@Module({
  controllers: [FloorTablesController],
  providers: [FloorTablesService],
  exports: [FloorTablesService],
})
export class FloorTablesModule {}
