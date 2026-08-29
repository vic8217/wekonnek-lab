import { UnauthorizedException } from '@nestjs/common';
import { WalletPaymentGateway } from '@prisma/client';
import { PaymentGatewayService } from './payment-gateway.service';

describe('PaymentGatewayService legacy webhook auth', () => {
  const service = new PaymentGatewayService({ get: () => undefined } as never);

  it.each([
    WalletPaymentGateway.paymongo,
    WalletPaymentGateway.maya,
    WalletPaymentGateway.xendit,
  ])('rejects unsigned %s callbacks before any credit', async (gateway) => {
    await expect(
      service.verifyWebhook({
        gateway,
        body: { id: 'pay-1', status: 'paid', data: { id: 'pay-1', attributes: { status: 'paid', amount: 50000 } } },
        headers: {},
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
