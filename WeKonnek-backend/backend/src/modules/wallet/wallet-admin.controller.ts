import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { WalletLedgerService } from './wallet-ledger.service';
import { CreateWalletAdjustmentDto } from './dto/create-wallet-adjustment.dto';

@ApiTags('Wallet')
@Controller('admin/wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class WalletAdminController {
  constructor(private readonly ledger: WalletLedgerService) {}

  @Post(':walletId/adjustments')
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Create an audited admin wallet credit or debit' })
  adjust(
    @Param('walletId') walletId: string,
    @Body() body: CreateWalletAdjustmentDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.ledger.adjustWallet({
      walletId,
      amount: body.amount,
      direction: body.direction,
      reason: body.reason,
      actorUserId: req.user.id,
      reference: body.idempotencyKey,
    });
  }
}
