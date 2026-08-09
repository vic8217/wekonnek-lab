import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { ListingInquiriesService } from './listing-inquiries.service';

@Controller('listing-inquiries')
@UseGuards(JwtAuthGuard)
export class ListingInquiriesController {
  constructor(private readonly service: ListingInquiriesService) {}
  @Get('profile-summary') summary(@Req() req: any) { return this.service.summary(req.user.id); }
  @Get() received(@Req() req: any, @Query('type') type?: string) { return this.service.received(req.user.id, type); }
  @Post(':type/:listingId') create(@Req() req: any, @Param('type') type: string, @Param('listingId') listingId: string, @Body() body: any) { return this.service.create(req.user.id, type, listingId, body); }
  @Patch(':id/read') markRead(@Req() req: any, @Param('id') id: string) { return this.service.markRead(req.user.id, id); }
}
