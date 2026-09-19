/**
 * Stage13B-3B SYSTEM ADMIN discovery GET.
 * Read-only. Does not alter frozen Stage13B-3A routes.
 */
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { parseSearchQuery } from './financial-reconciliation-search.policy';
import { FinancialReconciliationSearchService } from './financial-reconciliation-search.service';

type RequestUser = {
  id?: string;
  role?: UserRole;
  portal?: string;
};

@ApiTags('Financial Reconciliation Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
@Controller()
export class FinancialReconciliationAdminController {
  constructor(
    private readonly search: FinancialReconciliationSearchService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('admin/financial-reconciliation')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'SYSTEM ADMIN bounded financial reconciliation discovery',
  })
  async getAdminSearch(
    @Req() req: { user?: RequestUser },
    @Query() query: Record<string, string | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.suppressEtag(res);
    await this.assertPersistedAdmin(req.user);
    const parsed = parseSearchQuery(query);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: parsed.code,
        message: parsed.message,
      });
    }
    return this.search.search(parsed.value);
  }

  private async assertPersistedAdmin(user: RequestUser | undefined): Promise<void> {
    if (!user?.id) throw new UnauthorizedException();
    if (user.portal === 'shop') {
      throw new ForbiddenException('Financial reconciliation discovery is not available for this actor');
    }
    const persisted = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, isActive: true },
    });
    if (!persisted || persisted.isActive === false) {
      throw new UnauthorizedException();
    }
    if (persisted.role !== UserRole.admin) {
      throw new ForbiddenException(
        'Financial reconciliation discovery is not available for this actor',
      );
    }
  }

  private suppressEtag(res: Response): void {
    const end = res.end.bind(res);
    res.end = ((...args: Parameters<Response['end']>) => {
      res.removeHeader('ETag');
      return end(...args);
    }) as Response['end'];
  }
}
