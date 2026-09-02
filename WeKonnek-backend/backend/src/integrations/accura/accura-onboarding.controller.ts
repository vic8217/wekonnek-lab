import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
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
  constructor(private readonly onboarding: AccuraOnboardingService) {}

  @Get('profile')
  @ApiOperation({ summary: 'ACCURA e-receipt registration profile for the signed-in merchant' })
  getProfile(@Req() req: { user: { id: string; role?: string; portal?: string } }) {
    return this.onboarding.getSetup(req.user);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Save ACCURA taxpayer profile draft' })
  saveProfile(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Body() body: UpdateAccuraOnboardingProfileDto,
  ) {
    return this.onboarding.saveProfile(req.user, body);
  }

  @Get('readiness')
  @ApiOperation({ summary: 'ACCURA e-receipt setup completeness' })
  getReadiness(@Req() req: { user: { id: string; role?: string; portal?: string } }) {
    return this.onboarding.getReadiness(req.user);
  }

  @Get('branches')
  @ApiOperation({ summary: 'ACCURA registered branches for the signed-in merchant' })
  listBranches(@Req() req: { user: { id: string; role?: string; portal?: string } }) {
    return this.onboarding.listBranches(req.user);
  }

  @Post('branches')
  @ApiOperation({ summary: 'Create an ACCURA registered taxpayer branch' })
  createBranch(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Body() body: CreateAccuraOnboardingBranchDto,
  ) {
    return this.onboarding.createBranch(req.user, body);
  }

  @Patch('branches/:branchId')
  @ApiOperation({ summary: 'Update an ACCURA registered taxpayer branch' })
  updateBranch(
    @Req() req: { user: { id: string; role?: string; portal?: string } },
    @Param('branchId') branchId: string,
    @Body() body: UpdateAccuraOnboardingBranchDto,
  ) {
    return this.onboarding.updateBranch(req.user, branchId, body);
  }

  @Post('shop-mappings')
  @ApiOperation({ summary: 'Map a WeKonnek shop to an ACCURA registered branch' })
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
  @ApiOperation({ summary: 'Upload a supporting tax registration document to ACCURA' })
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
    if (!file) throw new BadRequestException('A registration document file is required');
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
  @ApiOperation({ summary: 'Submit ACCURA e-receipt setup for review' })
  submit(@Req() req: { user: { id: string; role?: string; portal?: string } }) {
    return this.onboarding.submit(req.user);
  }
}
