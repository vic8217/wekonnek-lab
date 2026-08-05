import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('branches')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller()
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get('merchants/:merchantId/branches')
  @ApiOperation({ summary: 'List branches for a merchant' })
  findAll(@Param('merchantId', ParseIntPipe) merchantId: number, @Req() req: any) {
    return this.branchesService.findAllByMerchant(merchantId, req.user);
  }

  @Post('merchants/:merchantId/branches')
  @ApiOperation({ summary: 'Create a branch' })
  create(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.branchesService.create(merchantId, body, req.user);
  }

  @Patch('branches/:id')
  @ApiOperation({ summary: 'Update a branch' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.branchesService.update(id, body, req.user);
  }

  @Post('branches/:id/passkey')
  @ApiOperation({ summary: 'Regenerate a branch shop-access passkey' })
  regeneratePasskey(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.branchesService.regeneratePasskey(id, req.user);
  }

  @Delete('branches/:id')
  @ApiOperation({ summary: 'Delete a branch' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.branchesService.remove(id, req.user);
  }
}
