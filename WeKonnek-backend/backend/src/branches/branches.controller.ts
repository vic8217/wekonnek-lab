import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
  findAll(@Param('merchantId', ParseIntPipe) merchantId: number) {
    return this.branchesService.findAllByMerchant(merchantId);
  }

  @Post('merchants/:merchantId/branches')
  @ApiOperation({ summary: 'Create a branch' })
  create(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body() body: any,
  ) {
    return this.branchesService.create(merchantId, body);
  }

  @Patch('branches/:id')
  @ApiOperation({ summary: 'Update a branch' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.branchesService.update(id, body);
  }

  @Delete('branches/:id')
  @ApiOperation({ summary: 'Delete a branch' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.branchesService.remove(id);
  }
}
