import { Logger } from '@nestjs/common';
import { ConnectedSocket, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
@WebSocketGateway({ namespace:'/dine-in', cors:{origin:'*'} })
export class DineInSyncGateway implements OnGatewayConnection {
  @WebSocketServer() server:Server;
  private readonly logger=new Logger('DineInSyncGateway');
  constructor(private readonly prisma:PrismaService,private readonly jwt:JwtService){}
  async handleConnection(client:Socket){
    try{
      const auth=client.handshake.auth||{}; let shopId:number|undefined;
      if(auth.crewSessionToken){const session=await this.prisma.crewDeviceSession.findUnique({where:{tokenHash:digest(String(auth.crewSessionToken))},include:{device:true,staff:true}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.device.status!=='active'||!session.staff.isActive)throw new Error();shopId=session.device.shopId;}
      else if(auth.accessToken){const payload=this.jwt.verify(String(auth.accessToken));if(payload.portal!=='shop'||!payload.branchId)throw new Error();shopId=Number(payload.branchId);}
      if(!shopId)throw new Error();client.data.shopId=shopId;await client.join(`dine-in-shop-${shopId}`);
    }catch{client.emit('authorization-error',{code:'DEVICE_NOT_AUTHORIZED'});client.disconnect(true)}
  }
  emitChange(shopId:number,cursor:string,type:string){this.server?.to(`dine-in-shop-${shopId}`).emit('dine-in-change',{cursor,type});}
  @SubscribeMessage('heartbeat') heartbeat(@ConnectedSocket() client:Socket){client.emit('heartbeat-ack',{serverTime:new Date().toISOString()})}
}
