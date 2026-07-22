import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { MerchantApplicationsService } from './merchant-applications.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('merchant-applications')
@Controller('merchant-applications')
export class MerchantApplicationsController {
  constructor(
    private readonly applicationsService: MerchantApplicationsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit a merchant application' })
  create(@Body() body: any) {
    return this.applicationsService.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'List merchant applications (optionally by status)' })
  @ApiQuery({ name: 'status', required: false })
  findAll(@Query('status') status?: string) {
    return this.applicationsService.findAll(status);
  }

  @Get('coordinator/leads')
  @UseGuards(JwtAuthGuard)
  coordinatorLeads(@Req() req: any) {
    return this.applicationsService.findCoordinatorLeads(req.user);
  }

  @Patch(':id/claim')
  @UseGuards(JwtAuthGuard)
  claim(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.claimLead(id, req.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single application' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.findById(id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve / reject / review an application' })
  updateStatus(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string; rejection_reason?: string; rejectionReason?: string },
  ) {
    return this.applicationsService.updateStatus(id, body.status, {
      reviewerId: req.user?.id,
      rejectionReason: body.rejection_reason || body.rejectionReason,
    });
  }
}
