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
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { UserRole } from '@prisma/client';

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

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset an approved merchant password with a recovery key' })
  resetPassword(@Body() body: { merchantId?: string; merchant_id?: string; merchantCode?: string; merchant_code?: string; recoveryKey?: string; recovery_key?: string; newPassword?: string; new_password?: string }) {
    return this.applicationsService.resetMerchantPassword(
      body.merchantId || body.merchant_id || body.merchantCode || body.merchant_code || '',
      body.recoveryKey || body.recovery_key || '',
      body.newPassword || body.new_password || '',
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'List merchant applications (optionally by status)' })
  @ApiQuery({ name: 'status', required: false })
  findAll(@Query('status') status?: string) {
    return this.applicationsService.findAll(status);
  }

  @Get('coverage-options')
  coverageOptions() {
    return this.applicationsService.coverageOptions();
  }

  @Get('coordinator/leads')
  @UseGuards(JwtAuthGuard)
  coordinatorLeads(@Req() req: any) {
    return this.applicationsService.findCoordinatorLeads(req.user);
  }

  @Get('coordinator/coverage-options')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.coordinator)
  coordinatorCoverageOptions(@Req() req: any) {
    return this.applicationsService.coordinatorCoverageOptions(req.user);
  }

  @Post('coordinator/leads')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.coordinator)
  @ApiOperation({ summary: 'Create and self-assign a merchant onboarding application' })
  createCoordinatorLead(@Req() req: any, @Body() body: Record<string, unknown>) {
    return this.applicationsService.createByCoordinator(body, req.user);
  }

  @Get('coordinator/leads/:id')
  @UseGuards(JwtAuthGuard)
  coordinatorLead(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.findAssignedCoordinatorLead(id, req.user);
  }

  @Patch('coordinator/leads/:id/details')
  @UseGuards(JwtAuthGuard)
  updateCoordinatorLeadDetails(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.applicationsService.updateCoordinatorLeadDetails(id, req.user, body);
  }

  @Post('coordinator/leads/:id/recovery-key')
  @UseGuards(JwtAuthGuard)
  generateCoordinatorMerchantRecoveryKey(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.applicationsService.generateCoordinatorMerchantRecoveryKey(id, req.user);
  }

  @Patch('coordinator/leads/:id/review')
  @UseGuards(JwtAuthGuard)
  updateCoordinatorReview(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      coordinator_notes?: string | null;
      payment_proof_url?: string | null;
      business_permit_url?: string | null;
      dti_permit_url?: string | null;
      valid_id_url?: string | null;
      establishment_photo_url?: string | null;
      authorized_person_photo_url?: string | null;
      business_documents_urls?: string[];
      subscription_tier?: string;
      selected_add_on_ids?: string[];
      selected_add_on_quantities?: Record<string, number>;
    },
  ) {
    return this.applicationsService.updateCoordinatorReview(id, req.user, body);
  }

  @Patch(':id/claim')
  @UseGuards(JwtAuthGuard)
  claim(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.claimLead(id, req.user);
  }

  @Get(':id/eligible-coordinators')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  eligibleCoordinators(@Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.eligibleCoordinators(id);
  }

  @Patch(':id/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  assignCoordinator(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { coordinator_user_id?: string },
  ) {
    return this.applicationsService.assignCoordinator(id, body.coordinator_user_id ?? '');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single application' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.applicationsService.findById(id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
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
