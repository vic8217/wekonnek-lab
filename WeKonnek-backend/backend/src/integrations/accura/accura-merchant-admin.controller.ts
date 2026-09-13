import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../modules/auth/guards/roles.guard';
import { AccuraMerchantAdminService } from './accura-merchant-admin.service';

@ApiTags('ACCURA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('integrations/accura/admin/merchants')
export class AccuraMerchantAdminController {
  constructor(private readonly admin: AccuraMerchantAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List merchant ACCURA connection diagnostics (read-only)',
  })
  list(
    @Query('filter')
    filter?:
      | 'all'
      | 'not_connected'
      | 'onboarding'
      | 'needs_action'
      | 'active'
      | 'suspended'
      | 'error',
  ) {
    return this.admin.listConnections(filter || 'all');
  }

  @Get(':merchantId')
  @ApiOperation({ summary: 'Merchant ACCURA connection detail (read-only)' })
  detail(@Param('merchantId', ParseIntPipe) merchantId: number) {
    return this.admin.getConnection(merchantId);
  }

  @Post(':merchantId/refresh-status')
  @ApiOperation({
    summary: 'Pull latest ACCURA status for a merchant (no compliance override)',
  })
  refresh(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.admin.refreshStatus(merchantId, req.user?.id);
  }
}
