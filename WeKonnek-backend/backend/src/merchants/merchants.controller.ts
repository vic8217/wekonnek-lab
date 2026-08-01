import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MerchantsService } from './merchants.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { SearchMerchantsDto } from './dto/search-merchants.dto';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { UserRole } from '@prisma/client';

@ApiTags('merchants')
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new merchant' })
  create(@Body() createMerchantDto: CreateMerchantDto) {
    return this.merchantsService.create(createMerchantDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all merchants (optionally filtered by status)' })
  findAll(@Query('status') status?: string) {
    return this.merchantsService.findAll(status);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the merchant profile owned by the logged-in user' })
  findMine(@Req() req: any) {
    return this.merchantsService.findByUserId(req.user.id);
  }

  @Get('me/subscription-coverage')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get wallet-funded subscription coverage for the logged-in merchant' })
  getMySubscriptionCoverage(@Req() req: any) {
    return this.merchantsService.getSubscriptionCoverage(req.user.id);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin merchant list with onboarding credentials' })
  findAllForAdmin(@Query('status') status?: string) {
    return this.merchantsService.findAllForAdmin(status);
  }

  @Get('admin/:id/details')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiBearerAuth()
  getAdminDetails(@Param('id', ParseIntPipe) id: number) {
    return this.merchantsService.getAdminDetails(id);
  }

  @Get('admin/:id/ledger')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiBearerAuth()
  getSubscriptionLedger(@Param('id', ParseIntPipe) id: number) {
    return this.merchantsService.getSubscriptionLedger(id);
  }

  @Post('admin/:id/recovery-key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiBearerAuth()
  generateRecoveryKey(@Param('id', ParseIntPipe) id: number) {
    return this.merchantsService.generateRecoveryKey(id);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search merchants by name, category, location, etc.' })
  search(@Query() searchDto: SearchMerchantsDto) {
    return this.merchantsService.search(searchDto);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get merchant by slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.merchantsService.findBySlug(slug);
  }

  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Get merchant by numeric ID or slug' })
  findOne(@Param('idOrSlug') idOrSlug: string) {
    return this.merchantsService.findByIdOrSlug(idOrSlug);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a merchant' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMerchantDto: UpdateMerchantDto,
  ) {
    return this.merchantsService.update(id, updateMerchantDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a merchant' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.merchantsService.remove(id);
  }
}
