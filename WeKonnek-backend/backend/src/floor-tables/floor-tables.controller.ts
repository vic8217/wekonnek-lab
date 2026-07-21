import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FloorTablesService } from './floor-tables.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('floor-tables')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller()
export class FloorTablesController {
  constructor(private readonly floorTablesService: FloorTablesService) {}

  @Get('merchants/:merchantId/floor-tables')
  @ApiOperation({ summary: 'List floor tables for a merchant' })
  findAll(@Param('merchantId', ParseIntPipe) merchantId: number) {
    return this.floorTablesService.findAllByMerchant(merchantId);
  }

  @Get('merchants/:merchantId/floor-tables/qr')
  @ApiOperation({ summary: 'Generate printable QR codes for dine-in tables' })
  generateQr(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Query('baseUrl') baseUrl: string,
  ) {
    return this.floorTablesService.generateQrCodes(merchantId, baseUrl);
  }

  @Post('merchants/:merchantId/floor-tables')
  @ApiOperation({ summary: 'Create a floor table' })
  create(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body() body: any,
  ) {
    return this.floorTablesService.create(merchantId, body);
  }

  @Patch('floor-tables/:id')
  @ApiOperation({ summary: 'Update a floor table' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.floorTablesService.update(id, body);
  }

  @Delete('floor-tables/:id')
  @ApiOperation({ summary: 'Delete a floor table' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.floorTablesService.remove(id);
  }

  @Put('merchants/:merchantId/floor-tables/bulk')
  @ApiOperation({ summary: 'Bulk update all floor tables for a merchant' })
  bulkUpdate(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body() body: { tables: any[] },
  ) {
    return this.floorTablesService.bulkUpdate(merchantId, body.tables);
  }
}
