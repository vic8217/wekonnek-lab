import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import type { LocationSampleBody } from './rider-assignments.report-location';
import { RiderAssignmentsService } from './rider-assignments.service';

/**
 * Native rider operations. Identity is the JWT subject.
 * Do not accept riderId from the query, body, route, or headers.
 */
@ApiTags('Rider assignments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rider/assignments')
export class RiderAssignmentsController {
  constructor(private readonly assignments: RiderAssignmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List current WkOrder deliveries for the authenticated rider',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  list(
    @Req() req: { user?: { id?: string } },
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.assignments.list(req.user, { limit, cursor });
  }

  @Get(':wkOrderId')
  @ApiOperation({
    summary: 'Read one WkOrder delivery for the authenticated rider',
  })
  detail(
    @Req() req: { user?: { id?: string } },
    @Param('wkOrderId', ParseIntPipe) wkOrderId: number,
  ) {
    return this.assignments.detail(req.user, wkOrderId);
  }

  @Post(':wkOrderId/start-delivery')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start delivery for one WkOrder (picked_up → in_transit)',
  })
  startDelivery(
    @Req() req: { user?: { id?: string } },
    @Param('wkOrderId', ParseIntPipe) wkOrderId: number,
  ) {
    return this.assignments.startDelivery(req.user, wkOrderId);
  }

  @Post(':wkOrderId/location')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Report one canonical location sample for one WkOrder',
  })
  reportLocation(
    @Req() req: { user?: { id?: string } },
    @Param('wkOrderId', ParseIntPipe) wkOrderId: number,
    @Body() body: LocationSampleBody,
  ) {
    return this.assignments.reportLocation(req.user, wkOrderId, body);
  }
}
