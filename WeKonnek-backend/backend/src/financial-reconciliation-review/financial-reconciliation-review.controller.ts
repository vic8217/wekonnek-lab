/**
 * Stage14A SYSTEM ADMIN operational review APIs.
 * Does not mutate frozen financial rails.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { FinancialReconciliationReviewService } from './financial-reconciliation-review.service';

type RequestUser = {
  id?: string;
  role?: UserRole;
  portal?: string;
};

@ApiTags('Financial Reconciliation Review')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller()
export class FinancialReconciliationReviewController {
  constructor(private readonly reviews: FinancialReconciliationReviewService) {}

  @Get('admin/financial-reconciliation/reviews')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'SYSTEM ADMIN bounded review search' })
  async list(
    @Req() req: { user?: RequestUser },
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.suppressEtag(res);
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.list(actor.id, query);
  }

  @Get('admin/financial-reconciliation/reviews/:id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'SYSTEM ADMIN review detail with live detector status' })
  async get(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.suppressEtag(res);
    await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.get(id);
  }

  @Post('admin/financial-reconciliation/reviews')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Open a follow-up from a live Stage13B finding, or return the existing open review',
  })
  async create(
    @Req() req: { user?: RequestUser },
    @Body() body: { wkOrderId?: unknown; findingKey?: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    const result = await this.reviews.create(actor.id, {
      wkOrderId: body.wkOrderId,
      findingKey: body.findingKey,
    });
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Post('admin/financial-reconciliation/reviews/:id/assign')
  @ApiOperation({ summary: 'Assign or unassign a review to a system admin' })
  async assign(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Body() body: { assignedAdminUserId?: unknown; expectedVersion?: unknown },
  ) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.assign(actor.id, id, body);
  }

  @Post('admin/financial-reconciliation/reviews/:id/notes')
  @ApiOperation({ summary: 'Append an operational review note' })
  async addNote(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Body() body: { body?: unknown; idempotencyKey?: unknown },
  ) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.addNote(actor.id, id, body);
  }

  @Post('admin/financial-reconciliation/reviews/:id/refresh')
  @ApiOperation({ summary: 'Refresh live Stage13B reconciliation for a review' })
  async refresh(@Req() req: { user?: RequestUser }, @Param('id') id: string) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.refresh(actor.id, id);
  }

  @Post('admin/financial-reconciliation/reviews/:id/route')
  @ApiOperation({ summary: 'Record non-financial route classification' })
  async route(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Body() body: { routeClassification?: unknown; expectedVersion?: unknown },
  ) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.classifyRoute(actor.id, id, body);
  }

  @Post('admin/financial-reconciliation/reviews/:id/waiting')
  @ApiOperation({ summary: 'Mark review waiting on a party type' })
  async waiting(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Body()
    body: {
      waitingPartyType?: unknown;
      expectedVersion?: unknown;
      reason?: unknown;
    },
  ) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.waitOnParty(actor.id, id, body);
  }

  @Post('admin/financial-reconciliation/reviews/:id/escalate')
  @ApiOperation({ summary: 'Escalate review to engineering (non-repairing)' })
  async escalate(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Body() body: { reason?: unknown; expectedVersion?: unknown },
  ) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.escalate(actor.id, id, body);
  }

  @Post('admin/financial-reconciliation/reviews/:id/close')
  @ApiOperation({
    summary: 'Close review by condition-cleared or review-only mode',
  })
  async close(
    @Req() req: { user?: RequestUser },
    @Param('id') id: string,
    @Body() body: { mode?: unknown; reason?: unknown; expectedVersion?: unknown },
  ) {
    const actor = await this.reviews.assertPersistedAdmin(req.user);
    return this.reviews.close(actor.id, id, body);
  }

  private suppressEtag(res: Response): void {
    const end = res.end.bind(res);
    res.end = ((...args: Parameters<Response['end']>) => {
      res.removeHeader('ETag');
      return end(...args);
    }) as Response['end'];
  }
}
