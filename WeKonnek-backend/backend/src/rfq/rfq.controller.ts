import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { RfqService } from './rfq.service';

@ApiTags('rfqs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rfqs')
export class RfqController {
  constructor(private readonly rfqs: RfqService) {}
  @Post() create(@Req() req: { user: { id: string } }, @Body() body: Parameters<RfqService['create']>[1]) { return this.rfqs.create(req.user.id, body); }
  @Get('mine') mine(@Req() req: { user: { id: string } }) { return this.rfqs.buyerList(req.user.id); }
  @Get('merchant') merchant(@Req() req: { user: { id: string } }) { return this.rfqs.merchantList(req.user.id); }
  @Get('mine/:id') detail(@Req() req: { user: { id: string } }, @Param('id') id: string) { return this.rfqs.buyerDetail(req.user.id, id); }
  @Get('merchant/:id') merchantDetail(@Req() req: { user: { id: string } }, @Param('id') id: string) { return this.rfqs.merchantDetail(req.user.id, id); }
  @Patch('mine/:id/cancel') cancel(@Req() req: { user: { id: string } }, @Param('id') id: string) { return this.rfqs.cancel(req.user.id, id); }
  @Post('merchant/:id/quotations') quote(@Req() req: { user: { id: string } }, @Param('id') id: string, @Body() body: Parameters<RfqService['quote']>[2]) { return this.rfqs.quote(req.user.id, id, body); }
  @Post('quotations/:id/accept') accept(@Req() req: { user: { id: string } }, @Param('id') id: string) { return this.rfqs.acceptQuotationAndCreateOrder(req.user.id, id); }
  @Post('quotations/:id/decline') decline(@Req() req: { user: { id: string } }, @Param('id') id: string) { return this.rfqs.declineQuotation(req.user.id, id); }
  @Post('quotations/:id/request-revision') requestRevision(@Req() req: { user: { id: string } }, @Param('id') id: string, @Body() body: { note?: string }) { return this.rfqs.requestQuotationRevision(req.user.id, id, body.note || ''); }
}
