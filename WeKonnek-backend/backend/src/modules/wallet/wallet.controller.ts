import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  Headers,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  WalletTransactionType,
  WalletPaymentGateway,
} from '@prisma/client';
import { WalletReloadService } from '../../payment-partners/wallet-reload.service';
import { CreateWalletReloadDto } from './dto/create-wallet-reload.dto';

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly walletReloadService: WalletReloadService,
  ) {}

  // ─── WALLET INFO ─────────────────────────────
  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get wallet info & balance' })
  getWallet(@Req() req: any) {
    return this.walletService.getOrCreateWallet(req.user.id);
  }

  @Get('balance')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get wallet balance' })
  getBalance(@Req() req: any) {
    return this.walletService.getBalance(req.user.id);
  }

  // ─── PIN ─────────────────────────────────────
  @Post('pin')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set or update wallet PIN' })
  setPin(@Req() req: any, @Body() body: { pin: string }) {
    return this.walletService.setPin(req.user.id, body.pin);
  }

  @Post('pin/verify')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Verify wallet PIN' })
  verifyPin(@Req() req: any, @Body() body: { pin: string }) {
    return this.walletService.verifyPin(req.user.id, body.pin);
  }

  @Post('reload')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Create a PayCools merchant wallet reload (does not credit the wallet)',
  })
  reload(@Req() req: any, @Body() body: CreateWalletReloadDto) {
    return this.walletReloadService.createPayCoolsReload(
      req.user.id,
      body.amount,
    );
  }

  @Get('reloads/:paymentId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get merchant wallet reload payment status' })
  getReload(@Req() req: any, @Param('paymentId') paymentId: string) {
    return this.walletReloadService.getReload(req.user.id, paymentId);
  }

  // ─── TOP-UP ──────────────────────────────────
  @Post('top-up')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Top-up wallet via payment gateway' })
  topUp(
    @Req() req: any,
    @Body()
    body: {
      amount: number;
      gateway: WalletPaymentGateway;
      paymentMethod: string; // gcash, grab_pay, card, bank
    },
  ) {
    return this.walletService.topUp(
      req.user.id,
      body.amount,
      body.gateway,
      body.paymentMethod,
    );
  }

  // ─── PAY (for orders) ───────────────────────
  @Post('pay')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Pay for an order using wallet balance' })
  pay(
    @Req() req: any,
    @Body()
    body: {
      amount: number;
      orderId: string;
      pin: string;
      description?: string;
    },
  ) {
    return this.walletService.pay(
      req.user.id,
      body.amount,
      body.orderId,
      body.pin,
      body.description,
    );
  }

  // ─── CASH-OUT ────────────────────────────────
  @Post('cash-out')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Hold wallet funds for cash-out (external payout is not disbursed in this release)',
  })
  cashOut(
    @Req() req: any,
    @Body()
    body: {
      amount: number;
      gateway: WalletPaymentGateway;
      bankCode: string;
      accountNumber: string;
      accountName: string;
      pin: string;
    },
  ) {
    return this.walletService.cashOut(
      req.user.id,
      body.amount,
      body.gateway,
      body.bankCode,
      body.accountNumber,
      body.accountName,
      body.pin,
    );
  }

  // ─── TRANSFER ────────────────────────────────
  @Post('transfer')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Transfer is not available (recipient credit is not implemented)' })
  transfer(
    @Req() req: any,
    @Body()
    body: {
      recipientPhone: string;
      amount: number;
      pin: string;
    },
  ) {
    return this.walletService.transfer(
      req.user.id,
      body.recipientPhone,
      body.amount,
      body.pin,
    );
  }

  // ─── TRANSACTIONS ────────────────────────────
  @Get('transactions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get transaction history' })
  @ApiQuery({ name: 'type', required: false, enum: WalletTransactionType })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  getTransactions(
    @Req() req: any,
    @Query('type') type?: WalletTransactionType,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.walletService.getTransactions(req.user.id, {
      type,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  // ─── WEBHOOKS (no auth — called by gateways) ─
  @Post('webhook/paymongo')
  @ApiOperation({ summary: 'PayMongo webhook endpoint' })
  webhookPayMongo(@Body() body: any, @Headers() headers: any) {
    return this.walletService.handleWebhook(
      WalletPaymentGateway.paymongo,
      body,
      headers,
    );
  }

  @Post('webhook/maya')
  @ApiOperation({ summary: 'Maya webhook endpoint' })
  webhookMaya(@Body() body: any, @Headers() headers: any) {
    return this.walletService.handleWebhook(
      WalletPaymentGateway.maya,
      body,
      headers,
    );
  }

  @Post('webhook/xendit')
  @ApiOperation({ summary: 'Xendit webhook endpoint' })
  webhookXendit(@Body() body: any, @Headers() headers: any) {
    return this.walletService.handleWebhook(
      WalletPaymentGateway.xendit,
      body,
      headers,
    );
  }
}
