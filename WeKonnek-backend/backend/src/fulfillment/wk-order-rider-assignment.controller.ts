import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuthActorService } from './auth-actor.service';
import { RiderAssignmentService } from './rider-assignment.service';

const RIDER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canonical WkOrder initial rider assignment.
 * Delegates to RiderAssignmentService.assign. Never sets allowReassignment.
 */
@ApiTags('WkOrder Rider Assignment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WkOrderRiderAssignmentController {
  constructor(
    private readonly assignments: RiderAssignmentService,
    private readonly actors: AuthActorService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('orders/:wkOrderId/rider-assignment')
  @ApiOperation({
    summary:
      'Authorized merchant/admin assigns an eligible rider to a canonical WkOrder',
  })
  async assignInitial(
    @Req() req: { user: { id: string; role?: string } },
    @Param('wkOrderId', ParseIntPipe) wkOrderId: number,
    @Body()
    body: {
      riderId?: string;
      reason?: string;
      correlationId?: string;
      allowReassignment?: unknown;
    } = {},
  ) {
    const riderId = String(body.riderId ?? '').trim();
    if (!RIDER_ID_RE.test(riderId)) {
      throw new BadRequestException({
        code: 'RIDER_ID_REQUIRED',
        message: 'riderId must be a UUID',
      });
    }
    const actor = await this.actors.resolve(req.user);
    const orderRow = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      select: { merchantId: true },
    });
    if (!orderRow) {
      throw new NotFoundException('Order not found');
    }
    const trustedAssigner =
      actor.type === 'SYSTEM_ADMIN' ||
      actor.type === 'INTERNAL_SERVICE' ||
      actor.type === 'SYSTEM';
    if (
      !trustedAssigner &&
      !actor.actorMerchantIds.includes(orderRow.merchantId)
    ) {
      throw new ForbiddenException(
        'Merchant actors may only operate their merchant/shop orders',
      );
    }
    const result = await this.assignments.assign({
      wkOrderId,
      riderId,
      actor,
      actorMerchantIds: actor.actorMerchantIds,
      merchantOwnerUserId: actor.merchantOwnerUserId,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      correlationId:
        typeof body.correlationId === 'string'
          ? body.correlationId
          : undefined,
    });
    const fulfillment = result.fulfillment;
    const assignment = result.assignment;
    const order =
      fulfillment.wkOrderId != null
        ? await this.prisma.wkOrder.findUnique({
            where: { id: fulfillment.wkOrderId },
            select: { orderCode: true },
          })
        : null;
    return {
      wkOrderId: fulfillment.wkOrderId,
      orderCode: order?.orderCode ?? null,
      fulfillmentId: fulfillment.id,
      assignmentId: assignment?.id ?? null,
      riderId: fulfillment.activeRiderId,
      assignmentStatus: assignment?.status ?? null,
      assignmentVersion: fulfillment.assignmentVersion,
      fulfillmentStatus: fulfillment.status,
      activeRiderId: fulfillment.activeRiderId,
      physicalCustodianRiderId: fulfillment.physicalCustodianRiderId,
      idempotent: result.idempotent === true,
    };
  }
}
