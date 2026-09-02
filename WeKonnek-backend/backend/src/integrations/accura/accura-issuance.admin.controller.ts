import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../modules/auth/guards/roles.guard';
import { AccuraIssuanceAdminService } from './accura-issuance.admin.service';

@ApiTags('ACCURA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller('integrations/accura/issuance')
export class AccuraIssuanceAdminController {
  constructor(private readonly admin: AccuraIssuanceAdminService) {}

  @Get('jobs/order/:wkOrderId')
  @ApiOperation({
    summary: 'ACCURA issuance job status for a WkOrder (admin)',
  })
  getForOrder(@Param('wkOrderId', ParseIntPipe) wkOrderId: number) {
    return this.admin.getJobForOrder(wkOrderId);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'ACCURA issuance job status (admin)' })
  getJob(@Param('jobId') jobId: string) {
    return this.admin.getJob(jobId);
  }

  @Post('jobs/:jobId/retry')
  @ApiOperation({
    summary: 'Reset a FAILED ACCURA issuance job to PENDING (admin)',
  })
  retry(@Param('jobId') jobId: string, @Req() req: { user?: { id?: string } }) {
    return this.admin.retryFailed(jobId, req.user?.id);
  }
}
