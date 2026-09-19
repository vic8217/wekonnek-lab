/**
 * Stage13B-3A read-only HTTP projection.
 * Calls frozen FinancialReconciliationService.forOrder / forObligation.
 * Does not wrap those reads in another transaction. Never writes.
 */
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseIntPipe,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  isFinancialRailId,
  projectObligation,
  projectOrderReconciliation,
  ReconciliationHttpActor,
} from './financial-reconciliation.http-policy';
import { FinancialReconciliationService } from './financial-reconciliation.service';

type RequestUser = {
  id?: string;
  portal?: string;
};

@ApiTags('Financial Reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FinancialReconciliationController {
  constructor(
    private readonly reconciliation: FinancialReconciliationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('orders/:wkOrderId/financial-reconciliation')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read-only financial reconciliation projection for an order',
  })
  async getOrderReconciliation(
    @Req() req: { user?: RequestUser },
    @Param('wkOrderId', ParseIntPipe) wkOrderId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.suppressEtag(res);
    const view = await this.reconciliation.forOrder(wkOrderId);
    const actor = await this.resolveActor(req.user);
    const projected = projectOrderReconciliation(view, actor);
    if (projected.status === 'forbidden') {
      throw new ForbiddenException(
        'Financial reconciliation is not available for this actor',
      );
    }
    return projected.body;
  }

  @Get('financial-obligations/:rail/:obligationId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read-only single financial obligation projection',
  })
  async getObligation(
    @Req() req: { user?: RequestUser },
    @Param('rail') rail: string,
    @Param('obligationId') obligationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.suppressEtag(res);
    if (!isFinancialRailId(rail)) {
      throw new BadRequestException('Invalid financial rail');
    }
    const item = await this.reconciliation.forObligation(rail, obligationId);
    const actor = await this.resolveActor(req.user);
    const projected = projectObligation(item, actor);
    if (projected.status === 'not_found') {
      throw new NotFoundException('Financial obligation not found');
    }
    return projected.body;
  }

  private async resolveActor(
    user: RequestUser | undefined,
  ): Promise<ReconciliationHttpActor> {
    if (!user?.id) {
      throw new UnauthorizedException();
    }
    const [persisted, owned] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, role: true, isActive: true },
      }),
      this.prisma.merchant.findMany({
        where: { userId: user.id },
        select: { id: true },
      }),
    ]);
    if (!persisted || persisted.isActive === false) {
      throw new UnauthorizedException();
    }
    return {
      userId: persisted.id,
      role: persisted.role as UserRole,
      ownedMerchantIds: owned.map((row) => row.id),
      portal: user.portal,
    };
  }

  private suppressEtag(res: Response): void {
    const end = res.end.bind(res);
    res.end = ((...args: Parameters<Response['end']>) => {
      res.removeHeader('ETag');
      return end(...args);
    }) as Response['end'];
  }
}
