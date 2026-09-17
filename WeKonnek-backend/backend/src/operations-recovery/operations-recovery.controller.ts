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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { OperationsRecoveryService } from './operations-recovery.service';

@ApiTags('Operations Recovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class OperationsRecoveryController {
  constructor(private readonly recoveries: OperationsRecoveryService) {}

  @Get('orders/:orderId/operations-recoveries')
  @ApiOperation({ summary: 'List Stage 11 operations recoveries for an order' })
  list(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.recoveries.listForOrder(orderId, req.user.id);
  }

  @Post('orders/:orderId/operations-recoveries')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({
    summary: 'SYSTEM_ADMIN explicit open of OperationsRecovery (Stage 11)',
  })
  open(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      openingTriggerCode: string;
      correlationId: string;
      notes?: string;
      sourceOperationalCaseId?: string;
      sourceDeliveryAttemptId?: string;
      sourceRedeliveryAuthorizationId?: string;
      stage9DeterminationId?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.recoveries.open({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      openingTriggerCode: body.openingTriggerCode,
      correlationId: body.correlationId,
      notes: body.notes,
      sourceOperationalCaseId: body.sourceOperationalCaseId,
      sourceDeliveryAttemptId: body.sourceDeliveryAttemptId,
      sourceRedeliveryAuthorizationId: body.sourceRedeliveryAuthorizationId,
      stage9DeterminationId: body.stage9DeterminationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Get('operations-recoveries/:id')
  @ApiOperation({ summary: 'Get a Stage 11 operations recovery' })
  get(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.recoveries.getById(id, req.user.id);
  }

  @Post('operations-recoveries/:id/investigate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'OPEN → INVESTIGATING' })
  investigate(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { correlationId?: string; reason?: string } = {},
  ) {
    return this.recoveries.startInvestigation({
      recoveryId: id,
      actorUserId: req.user.id,
      correlationId: body.correlationId,
      reason: body.reason,
    });
  }

  @Post('operations-recoveries/:id/evidence')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'Append investigation evidence' })
  evidence(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      evidenceKind: string;
      notes?: string;
      storageReference?: string;
      contentHash?: string;
      contentType?: string;
      supersedesEvidenceId?: string;
      correlationId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.recoveries.addEvidence({
      recoveryId: id,
      actorUserId: req.user.id,
      evidenceKind: body.evidenceKind,
      notes: body.notes,
      storageReference: body.storageReference,
      contentHash: body.contentHash,
      contentType: body.contentType,
      supersedesEvidenceId: body.supersedesEvidenceId,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata as
        | import('@prisma/client').Prisma.InputJsonValue
        | undefined,
    });
  }

  @Post('operations-recoveries/:id/verifications')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'Record SYSTEM_ADMIN verification (not a report)' })
  verify(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      verificationCode: string;
      notes?: string;
      correlationId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.recoveries.addVerification({
      recoveryId: id,
      actorUserId: req.user.id,
      verificationCode: body.verificationCode,
      notes: body.notes,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      metadata: body.metadata as
        | import('@prisma/client').Prisma.InputJsonValue
        | undefined,
    });
  }

  @Post('operations-recoveries/:id/disposition')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'Select / change Stage 11 disposition' })
  disposition(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      disposition: string;
      reason: string;
      correlationId: string;
      idempotencyKey?: string;
    },
  ) {
    return this.recoveries.selectDisposition({
      recoveryId: id,
      actorUserId: req.user.id,
      disposition: body.disposition,
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('operations-recoveries/:id/actions/clear-pending-custody-transfer')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({
    summary:
      'Clear Stage 7 pending custody transfer intent (no RIDER_TRANSFER_* events)',
  })
  clearPending(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      reason: string;
      correlationId: string;
      idempotencyKey?: string;
    },
  ) {
    return this.recoveries.clearPendingCustodyTransferIntent({
      recoveryId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('operations-recoveries/:id/close')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'Close recovery under disposition-specific policy' })
  close(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      reason?: string;
      correlationId: string;
      explicitConclusionAcknowledged?: boolean;
      idempotencyKey?: string;
    },
  ) {
    return this.recoveries.close({
      recoveryId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
      explicitConclusionAcknowledged: body.explicitConclusionAcknowledged,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('operations-recoveries/:id/cancel')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'Cancel an active operations recovery' })
  cancel(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      reason: string;
      correlationId: string;
      idempotencyKey?: string;
    },
  ) {
    return this.recoveries.cancel({
      recoveryId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
