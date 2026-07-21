import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StoreProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Store Products')
@Controller('store-products')
export class StoreProductsController {
  constructor(private readonly productsService: StoreProductsService) {}

  @Get('store/:storeId')
  findByStore(@Param('storeId') storeId: string) {
    return this.productsService.findByStore(storeId);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.productsService.search(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() data: any) {
    return this.productsService.create(data);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.productsService.update(id, data);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id/toggle-availability')
  toggleAvailability(@Param('id') id: string) {
    return this.productsService.toggleAvailability(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.productsService.delete(id);
  }
}
