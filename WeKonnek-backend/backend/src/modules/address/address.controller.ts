import {
  Controller, Get, Post, Put, Delete,
  Body, Param, UseGuards, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AddressService } from './address.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Addresses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get()
  findMine(@Req() req: any) {
    return this.addressService.findByUser(req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() data: any) {
    return this.addressService.create({ ...data, userId: req.user.id });
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.addressService.update(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.addressService.delete(id);
  }
}
