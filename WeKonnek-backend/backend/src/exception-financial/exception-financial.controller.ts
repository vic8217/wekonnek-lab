import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { AllocationDraft } from './exception-financial.policy';
import { ExceptionFinancialService } from './exception-financial.service';

/**
 * Stage 12 routes. Every mutation is SYSTEM_ADMIN (UserRole.admin) only —
 * parties have read access to their own lifecycle view and nothing more.
 */
@ApiTags('Exception Financial Liability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ExceptionFinancialController {
  constructor(private readonly exceptions: ExceptionFinancialService) {}

  @Get('orders/:orderId/exception-claims')
  @ApiOperation({ summary: 'List Stage 12 exception claims for an order' })
  list(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.exceptions.listClaimsForOrder(orderId, req.user.id);
  }

  @Get('exception-claims/:id')
  @ApiOperation({ summary: 'Get a Stage 12 exception claim' })
  get(@Req() req: { user: { id: string } }, @Param('id') id: string) {
    return this.exceptions.getClaim(id, req.user.id);
  }

  @Post('operations-recoveries/:recoveryId/exception-claims')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({
    summary:
      'SYSTEM_ADMIN opens an exception claim from a FINANCIAL_REVIEW_REQUIRED recovery',
  })
  open(
    @Req() req: { user: { id: string } },
    @Param('recoveryId') recoveryId: string,
    @Body()
    body: {
      claimType: string;
      subjectRef: string;
      claimedAmount?: string | number | null;
      nonConformanceReasonCode?: string | null;
      correlationId: string;
      idempotencyKey?: string;
      notes?: string;
    },
  ) {
    return this.exceptions.openClaimFromRecovery({
      operationsRecoveryId: recoveryId,
      actorUserId: req.user.id,
      claimType: body.claimType,
      subjectRef: body.subjectRef,
      claimedAmount: body.claimedAmount,
      nonConformanceReasonCode: body.nonConformanceReasonCode,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      notes: body.notes,
    });
  }

  @Post('exception-claims/:id/order-terms-evidence')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({
    summary:
      'Attach immutable authoritative WkOrder/OrderItem terms snapshot as claim evidence',
  })
  attachOrderTerms(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: { correlationId: string; idempotencyKey?: string },
  ) {
    return this.exceptions.attachOrderTermsEvidence({
      claimId: id,
      actorUserId: req.user.id,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('exception-claims/:id/evidence')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Append claim evidence' })
  addEvidence(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      evidenceKind: string;
      visibility?: string;
      notes?: string;
      storageReference?: string;
      contentHash?: string;
      contentType?: string;
      correlationId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.exceptions.addEvidence({
      claimId: id,
      actorUserId: req.user.id,
      evidenceKind: body.evidenceKind,
      visibility: body.visibility,
      notes: body.notes,
      storageReference: body.storageReference,
      contentHash: body.contentHash,
      contentType: body.contentType,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata as Prisma.InputJsonValue | undefined,
    });
  }

  @Post('exception-claims/:id/evidence/:evidenceId/verify')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Record a SYSTEM_ADMIN evidence verification' })
  verifyEvidence(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Body()
    body: {
      verificationStatus: string;
      notes?: string;
      correlationId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.exceptions.verifyEvidence({
      claimId: id,
      evidenceId,
      actorUserId: req.user.id,
      verificationStatus: body.verificationStatus,
      notes: body.notes,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata as Prisma.InputJsonValue | undefined,
    });
  }

  @Post('exception-claims/:id/verified-facts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Conclude an immutable verified fact' })
  concludeFact(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      factType: string;
      statement: string;
      subjectRef?: string;
      attributedPartyType?: string | null;
      attributedPartyUserId?: string | null;
      attributedMerchantId?: number | null;
      supportingEvidenceId?: string | null;
      correlationId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.exceptions.concludeVerifiedFact({
      claimId: id,
      actorUserId: req.user.id,
      factType: body.factType,
      statement: body.statement,
      subjectRef: body.subjectRef,
      attributedPartyType: body.attributedPartyType,
      attributedPartyUserId: body.attributedPartyUserId,
      attributedMerchantId: body.attributedMerchantId,
      supportingEvidenceId: body.supportingEvidenceId,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata as Prisma.InputJsonValue | undefined,
    });
  }

  @Post('exception-claims/:id/determinations')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Create a DRAFT liability determination' })
  createDetermination(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      allocations: AllocationDraft[];
      reason?: string;
      correlationId: string;
      idempotencyKey?: string;
    },
  ) {
    return this.exceptions.createDetermination({
      claimId: id,
      actorUserId: req.user.id,
      allocations: body.allocations ?? [],
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('liability-determinations/:id/propose')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'DRAFT → PROPOSED' })
  propose(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: { reason?: string; correlationId: string; idempotencyKey?: string },
  ) {
    return this.exceptions.proposeDetermination({
      determinationId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('liability-determinations/:id/finalize')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({
    summary:
      'Finalize liability: Stage 9 gate, coverage import, allocations and obligations',
  })
  finalize(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: { reason?: string; correlationId: string; idempotencyKey?: string },
  ) {
    return this.exceptions.finalizeDetermination({
      determinationId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('liability-determinations/:id/adjustments')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: 'Create an adjustment bound to a FINALIZED determination',
  })
  adjust(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      allocations: AllocationDraft[];
      reason: string;
      correlationId: string;
      idempotencyKey?: string;
    },
  ) {
    return this.exceptions.createAdjustment({
      determinationId: id,
      actorUserId: req.user.id,
      allocations: body.allocations ?? [],
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
