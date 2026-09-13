import {
  BadRequestException,
  Body,
  Controller,
  Get,
  GoneException,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../modules/auth/guards/roles.guard';
import {
  CreateAccuraOnboardingBranchDto,
  CreateAccuraHandoffDto,
  MapAccuraShopBranchDto,
  UpdateAccuraOnboardingBranchDto,
  UpdateAccuraOnboardingProfileDto,
} from './accura-onboarding.dto';
import { AccuraOnboardingService } from './accura-onboarding.service';
import { ACCURA_DOCUMENT_MAX_BYTES } from './accura-onboarding.types';

@ApiTags('ACCURA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.merchant)
@Controller('integrations/accura/onboarding')
export class AccuraOnboardingController {
  constructor(
    private readonly onboarding: AccuraOnboardingService,
    private readonly config: ConfigService,
  ) {}

  private rejectLegacyWrite(operation: string): void {
    const enabled =
      this.config.get<string>('ACCURA_LEGACY_ONBOARDING_WRITE')?.trim() ===
      'true';
    if (!enabled) {
      throw new GoneException(
        `${operation} is deprecated. Complete taxpayer setup in ACCURA via handoff.`,
      );
    }
  }

  @Get('profile')
  @ApiOperation({
    summary: 'ACCURA e-receipt registration profile for the signed-in merchant',
  })
  getProfile(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
  ) {
    return this.onboarding.getSetup(req.user);
  }

  @Patch('profile')
  @ApiOperation({
    summary:
      '[Deprecated] Save ACCURA taxpayer profile draft — use ACCURA handoff',
    deprecated: true,
  })
  saveProfile(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Body() body: UpdateAccuraOnboardingProfileDto,
  ) {
    this.rejectLegacyWrite('Taxpayer profile write');
    return this.onboarding.saveProfile(req.user, body);
  }

  @Get('readiness')
  @ApiOperation({ summary: 'ACCURA e-receipt setup completeness' })
  getReadiness(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
  ) {
    return this.onboarding.getReadiness(req.user);
  }

  @Get('branches')
  @ApiOperation({
    summary: 'ACCURA registered branches for the signed-in merchant',
  })
  listBranches(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
  ) {
    return this.onboarding.listBranches(req.user);
  }

  @Post('branches')
  @ApiOperation({
    summary: '[Deprecated] Create ACCURA registered branch — use ACCURA handoff',
    deprecated: true,
  })
  createBranch(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Body() body: CreateAccuraOnboardingBranchDto,
  ) {
    this.rejectLegacyWrite('ACCURA branch create');
    return this.onboarding.createBranch(req.user, body);
  }

  @Patch('branches/:branchId')
  @ApiOperation({
    summary: '[Deprecated] Update ACCURA registered branch — use ACCURA handoff',
    deprecated: true,
  })
  updateBranch(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Param('branchId') branchId: string,
    @Body() body: UpdateAccuraOnboardingBranchDto,
  ) {
    this.rejectLegacyWrite('ACCURA branch update');
    return this.onboarding.updateBranch(req.user, branchId, body);
  }

  @Post('shop-mappings')
  @ApiOperation({
    summary: 'Map a WeKonnek shop to an ACCURA registered branch',
  })
  mapShop(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Body() body: MapAccuraShopBranchDto,
  ) {
    return this.onboarding.mapShop(req.user, {
      shopId: body.shopId,
      accuraBranchId: body.accuraBranchId ?? null,
    });
  }

  @Get('documents')
  @ApiOperation({ summary: 'ACCURA supporting document metadata' })
  async listDocuments(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
  ) {
    const setup = await this.onboarding.getSetup(req.user);
    return { items: setup.documents };
  }

  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '[Deprecated] Upload supporting document — use ACCURA handoff',
    deprecated: true,
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ACCURA_DOCUMENT_MAX_BYTES },
    }),
  )
  uploadDocument(
    @Req()
    req: {
      user: { id: string; role?: string; portal?: string };
      body?: { documentType?: string };
    },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('documentType') documentType: string,
  ) {
    this.rejectLegacyWrite('Document upload');
    if (!file)
      throw new BadRequestException('A registration document file is required');
    return this.onboarding.uploadDocument(
      req.user,
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
      documentType || req.body?.documentType || '',
    );
  }

  @Post('submit')
  @ApiOperation({
    summary:
      '[Deprecated] Submit ACCURA setup for review — use ACCURA handoff',
    deprecated: true,
  })
  submit(@Req() req: { user: { id: string; role?: string; portal?: string } }) {
    this.rejectLegacyWrite('Compliance submit');
    return this.onboarding.submit(req.user);
  }

  @Post('handoff')
  @ApiOperation({
    summary:
      'Create a one-time ACCURA COMPLETE_SETUP handoff for the signed-in merchant',
  })
  createHandoff(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Body() body: CreateAccuraHandoffDto,
  ) {
    return this.onboarding.createHandoff(req.user, body);
  }
}
