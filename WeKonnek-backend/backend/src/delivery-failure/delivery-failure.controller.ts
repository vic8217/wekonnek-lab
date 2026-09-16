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
import { DeliveryFailureService } from './delivery-failure.service';

@ApiTags('Delivery Failure / Operational Cases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DeliveryFailureController {
  constructor(private readonly failures: DeliveryFailureService) {}

  @Post('orders/:orderId/delivery-failures')
  @ApiOperation({
    summary:
      'Active physical custodian rider reports a failed delivery attempt and opens an operational case',
  })
  reportFailure(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      riderId?: string;
      failureReasonCode: string;
      customerResponse?: string;
      notes?: string;
      occurredAt?: string;
      correlationId?: string;
      idempotencyKey?: string;
      locationLatitude?: string | number;
      locationLongitude?: string | number;
      locationProvenance?: string;
      evidences?: Array<{
        evidenceKind: string;
        storageReference?: string;
        contentHash?: string;
        contentType?: string;
        sizeBytes?: number;
        agreementEvidenceId?: string;
        metadata?: Record<string, unknown>;
      }>;
    },
  ) {
    return this.failures.reportFailure({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      riderId: body.riderId,
      failureReasonCode: body.failureReasonCode,
      customerResponse: body.customerResponse,
      notes: body.notes,
      occurredAt: body.occurredAt,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      locationLatitude: body.locationLatitude,
      locationLongitude: body.locationLongitude,
      locationProvenance: body.locationProvenance,
      evidences: body.evidences,
    });
  }

  @Get('orders/:orderId/delivery-attempts')
  @ApiOperation({
    summary: 'List delivery attempts for an order (privacy filtered by role)',
  })
  listAttempts(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.failures.listAttempts(orderId, req.user.id);
  }

  @Get('orders/:orderId/operational-case')
  @ApiOperation({
    summary: 'Get current delivery-failure operational case for an order',
  })
  getCase(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.failures.getCase(orderId, req.user.id);
  }

  @Post('operational-cases/:id/disposition')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({
    summary: 'SYSTEM_ADMIN selects disposition for an operational case',
  })
  selectDisposition(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      disposition: string;
      reason: string;
      correlationId: string;
    },
  ) {
    return this.failures.selectDisposition({
      caseId: id,
      actorUserId: req.user.id,
      disposition: body.disposition,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }

  @Post('operational-cases/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({
    summary:
      'SYSTEM_ADMIN resolves an operational case (no custody/payment/RA fabrication)',
  })
  resolveCase(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      reason: string;
      correlationId: string;
    },
  ) {
    return this.failures.resolveCase({
      caseId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }
}
