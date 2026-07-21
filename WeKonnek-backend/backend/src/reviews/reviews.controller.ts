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
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a review' })
  create(@Req() req: any, @Body() body: any) {
    return this.reviewsService.create(req.user.id, body);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List reviews — by merchantId, productId, or own reviews' })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'productId', required: false })
  findAll(
    @Req() req: any,
    @Query('merchantId') merchantId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.reviewsService.findAll({
      userId: req.user.id,
      merchantId: merchantId ? Number(merchantId) : undefined,
      productId: productId ? Number(productId) : undefined,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single review' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.reviewsService.findById(id);
  }

  @Patch(':id/respond')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Merchant responds to a review' })
  respond(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { response_text: string },
  ) {
    return this.reviewsService.respond(id, body.response_text);
  }
}
