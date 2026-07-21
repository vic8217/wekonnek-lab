import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { MerchantStaffService } from './merchant-staff.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('merchant-staff')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller()
export class MerchantStaffController {
  constructor(private readonly merchantStaffService: MerchantStaffService) {}

  @Get('merchants/:merchantId/staff')
  @ApiOperation({ summary: 'List staff for a merchant' })
  findAll(@Param('merchantId', ParseIntPipe) merchantId: number) {
    return this.merchantStaffService.findAllByMerchant(merchantId);
  }

  @Post('merchants/:merchantId/staff')
  @ApiOperation({ summary: 'Add a staff member' })
  addStaff(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body() body: any,
  ) {
    return this.merchantStaffService.addStaff(merchantId, body);
  }

  @Patch('merchant-staff/:id')
  @ApiOperation({ summary: 'Update staff role or branch assignment' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.merchantStaffService.update(id, body);
  }

  @Delete('merchant-staff/:id')
  @ApiOperation({ summary: 'Remove a staff member' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.merchantStaffService.remove(id);
  }
}
