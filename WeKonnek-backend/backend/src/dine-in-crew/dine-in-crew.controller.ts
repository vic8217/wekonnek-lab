import { Body, Controller, ForbiddenException, Get, Headers, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { DineInCrewService } from './dine-in-crew.service';
import { DineInSyncService } from './dine-in-sync.service';

@ApiTags('Dine-In Crew & Devices')
@Controller('dine-in-crew')
export class DineInCrewController {
  constructor(private readonly service: DineInCrewService, private readonly syncService:DineInSyncService) {}
  @Get('overview') @UseGuards(JwtAuthGuard) @ApiBearerAuth() overview(@Req() req:any) { return this.service.overview(req.user.id, req.user.portal === 'shop' ? Number(req.user.branchId) : undefined); }
  @Post('crew') @UseGuards(JwtAuthGuard) @ApiBearerAuth() createCrew(@Req() req:any,@Body() body:any) { return this.service.createCrew(req.user.id, { ...body, ...(req.user.portal === 'shop' ? { shopId: Number(req.user.branchId) } : {}) }); }
  @Patch('crew/:id') @UseGuards(JwtAuthGuard) @ApiBearerAuth() updateCrew(@Req() req:any,@Param('id',ParseIntPipe) id:number,@Body() body:any) { return this.service.updateCrew(req.user.id,id,body); }
  @Post('pairings') @UseGuards(JwtAuthGuard) @ApiBearerAuth() pairing(@Req() req:any,@Body() body:any) { return this.service.createPairing(req.user.id,{ ...body, ...(req.user.portal === 'shop' ? { shopId: Number(req.user.branchId) } : {}) }); }
  @Post('pair') pair(@Body() body:any) { return this.service.pairDevice(body); }
  @Get('device/crew') deviceCrew(@Headers('x-crew-device-token') token?:string) { return this.service.deviceCrew(token); }
  @Post('device/login') login(@Headers('x-crew-device-token') token:string|undefined,@Body() body:any) { return this.service.crewLogin(token,body); }
  @Get('counter') counter(@Headers('x-crew-session-token') token?:string) { return this.service.counterSnapshot(token); }
  @Get('counter/sync') sync(@Headers('x-crew-session-token') token:string|undefined,@Query('cursor') cursor='0') { return this.service.counterChanges(token,cursor); }
  @Get('counter/menu') menu(@Headers('x-crew-session-token') token?:string) { return this.service.crewMenu(token); }
  @Post('counter/operational-token') operationalToken(@Headers('x-crew-session-token') token?:string) { return this.service.operationalToken(token); }
  @Get('shop/sync') @UseGuards(JwtAuthGuard) @ApiBearerAuth() shopSync(@Req() req:any,@Query('cursor') cursor='0') { if(req.user.portal!=='shop'||!req.user.branchId) throw new ForbiddenException('Shop session required'); return this.syncService.changes(Number(req.user.branchId),cursor); }
  @Patch('counter/orders/:id/accept') accept(@Headers('x-crew-session-token') token:string|undefined,@Param('id',ParseIntPipe) id:number) { return this.service.crewAcceptOrder(token,id); }
  @Patch('counter/orders/:id/items/:itemId/status') itemStatus(@Headers('x-crew-session-token') token:string|undefined,@Param('id',ParseIntPipe) id:number,@Param('itemId',ParseIntPipe) itemId:number,@Body() body:{status:string}) { return this.service.crewUpdateItem(token,id,itemId,body.status); }
  @Patch('counter/service-requests/:id/complete') completeServiceRequest(@Headers('x-crew-session-token') token:string|undefined,@Param('id',ParseIntPipe) id:number) { return this.service.crewCompleteServiceRequest(token,id); }
  @Patch('devices/:id/revoke') @UseGuards(JwtAuthGuard) @ApiBearerAuth() revoke(@Req() req:any,@Param('id') id:string) { return this.service.revokeDevice(req.user.id,id); }
}
