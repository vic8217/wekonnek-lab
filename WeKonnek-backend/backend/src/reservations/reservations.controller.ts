import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('reservations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a reservation' })
  create(@Req() req: any, @Body() body: any) {
    return this.reservationsService.create(req.user.id, body);
  }

  @Get()
  @ApiOperation({
    summary:
      'List reservations. merchantId → merchant view, admin/staff → all, otherwise own',
  })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'admin', required: false })
  @ApiQuery({ name: 'status', required: false })
  findAll(
    @Req() req: any,
    @Query('merchantId') merchantId?: string,
    @Query('admin') admin?: string,
    @Query('status') status?: string,
  ) {
    const role = req.user?.role;
    const isAdmin = admin === 'true' || role === 'admin' || role === 'staff';
    return this.reservationsService.findAll({
      merchantId: merchantId ? Number(merchantId) : undefined,
      userId: req.user.id,
      isAdmin,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single reservation' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.reservationsService.findById(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update reservation status (PATCH)' })
  updateStatusPatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
  ) {
    return this.reservationsService.updateStatus(id, body.status);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update reservation status (PUT)' })
  updateStatusPut(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
  ) {
    return this.reservationsService.updateStatus(id, body.status);
  }
}
