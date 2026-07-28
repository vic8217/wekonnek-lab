import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Public subscription plan matrix (tiers, prices, features)' })
  getPlans() {
    return this.subscriptionsService.getPlans();
  }

  @Get('definitions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: list configurable subscription tiers' })
  getDefinitions(@Req() req: any) {
    this.assertAdmin(req);
    return this.subscriptionsService.getPlanDefinitions();
  }

  @Post('definitions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: create a subscription tier' })
  createDefinition(@Req() req: any, @Body() body: any) {
    this.assertAdmin(req);
    return this.subscriptionsService.createPlanDefinition(body);
  }

  @Patch('definitions/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: update a subscription tier' })
  updateDefinition(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    this.assertAdmin(req);
    return this.subscriptionsService.updatePlanDefinition(id, body);
  }

  @Post('upgrade')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Upgrade/renew the logged-in merchant subscription' })
  upgrade(@Req() req: any, @Body() body: any) {
    return this.subscriptionsService.upgrade(req.user.id, body);
  }

  @Get('history')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Billing history for the logged-in merchant' })
  history(@Req() req: any) {
    return this.subscriptionsService.history(req.user.id);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: list subscription payments' })
  @ApiQuery({ name: 'status', required: false })
  findAll(@Req() req: any, @Query('status') status?: string) {
    this.assertAdmin(req);
    return this.subscriptionsService.findAll(status);
  }

  @Patch(':id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: approve a manual subscription payment' })
  approve(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    this.assertAdmin(req);
    return this.subscriptionsService.approve(id, req.user.id);
  }

  @Patch(':id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: reject a manual subscription payment' })
  reject(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    this.assertAdmin(req);
    return this.subscriptionsService.reject(id, body?.reason, req.user.id);
  }

  private assertAdmin(req: any) {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'staff') {
      throw new ForbiddenException('Admin access required');
    }
  }
}
