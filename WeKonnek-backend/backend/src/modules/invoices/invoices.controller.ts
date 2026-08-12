import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Request,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { UpdateBillingProfileDto } from './dto/update-merchant.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
import { InvoiceType, InvoiceStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Invoices / E-Receipts')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  // ═══════════════════════════════════════════════════
  //  BILLING PROFILE SETTINGS (Admin)
  // ═══════════════════════════════════════════════════

  @Get('billing-profile')
  @ApiOperation({ summary: 'Get default billing profile / company settings' })
  async getBillingProfile() {
    return this.invoicesService.getDefaultBillingProfile();
  }

  @Put('billing-profile/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update billing profile / company settings (Admin)' })
  async updateBillingProfile(
    @Param('id') id: string,
    @Body() dto: UpdateBillingProfileDto,
  ) {
    return this.invoicesService.updateBillingProfile(id, dto);
  }

  // ═══════════════════════════════════════════════════
  //  INVOICE LIST & QUERIES
  // ═══════════════════════════════════════════════════

  @Get()
  @ApiOperation({ summary: 'List invoices (Admin — with filters)' })
  @ApiQuery({ name: 'type', required: false, enum: InvoiceType })
  @ApiQuery({ name: 'status', required: false, enum: InvoiceStatus })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async findAll(
    @Query('type') type?: InvoiceType,
    @Query('status') status?: InvoiceStatus,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.invoicesService.findAll({
      type,
      status,
      dateFrom,
      dateTo,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('customer/:customerId')
  @ApiOperation({ summary: 'List invoices for a specific customer' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async findByCustomer(
    @Param('customerId') customerId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.invoicesService.findByCustomer(customerId, {
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the logged-in customer’s saved e-receipts' })
  async findMine(@Request() req: any) {
    await this.invoicesService.ensureCustomerDineInReceipts(req.user.id);
    return this.invoicesService.findByCustomer(req.user.id, { limit: 100 });
  }

  @Get('my/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'View one of the logged-in customer’s saved e-receipts' })
  async findMineById(@Request() req: any, @Param('id') id: string) {
    return this.invoicesService.findMineById(id, req.user.id);
  }

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get invoice for a specific order' })
  async findByOrder(@Param('orderId') orderId: string) {
    const invoice = await this.invoicesService.findByOrderId(orderId);
    if (!invoice) {
      return { message: 'No invoice found for this order' };
    }
    return invoice;
  }

  // ═══════════════════════════════════════════════════
  //  SINGLE INVOICE (JSON / XML / PDF)
  // ═══════════════════════════════════════════════════

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID (JSON)' })
  async findOne(@Param('id') id: string) {
    return this.invoicesService.findById(id);
  }

  @Get(':id/json')
  @ApiOperation({ summary: 'Get invoice in structured JSON format' })
  async getJson(@Param('id') id: string) {
    return this.invoicesService.getInvoiceJson(id);
  }

  @Get(':id/xml')
  @ApiOperation({ summary: 'Get invoice in XML format (BIR compliance)' })
  @Header('Content-Type', 'application/xml')
  async getXml(@Param('id') id: string, @Res() res: Response) {
    const xml = await this.invoicesService.getInvoiceXml(id);
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download invoice as PDF e-receipt (Grab-style)' })
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const invoice = await this.invoicesService.findById(id);
    const pdfBuffer = await this.invoicesService.generatePdf(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${invoice.serialNumber}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  }

  // ═══════════════════════════════════════════════════
  //  VOID / REFUND
  // ═══════════════════════════════════════════════════

  @Post(':id/void')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Void an invoice (Admin)' })
  async voidInvoice(
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @Request() req: any,
  ) {
    const voidedBy = req.user?.id ?? 'admin';
    return this.invoicesService.voidInvoice(id, dto.reason, voidedBy);
  }

  // ═══════════════════════════════════════════════════
  //  SALES SUMMARY (for BIR reporting)
  // ═══════════════════════════════════════════════════

  @Get('reports/sales-summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get sales summary for a date range (BIR reporting)' })
  @ApiQuery({ name: 'dateFrom', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo', required: true, description: 'YYYY-MM-DD' })
  async salesSummary(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.invoicesService.getSalesSummary(dateFrom, dateTo);
  }
}
