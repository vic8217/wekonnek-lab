import { Body, Controller, Delete, Get, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { BazaarPromosService } from './bazaar-promos.service';

@Controller('bazaar-promos')
export class BazaarPromosController {
  constructor(private readonly service: BazaarPromosService) {}
  @Get() findAll(@Query('activeOnly', new ParseBoolPipe({ optional: true })) activeOnly?: boolean) { return this.service.findAll(Boolean(activeOnly)); }
  @Post() create(@Body() body: any) { return this.service.create(body); }
  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.service.update(id, body); }
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}
