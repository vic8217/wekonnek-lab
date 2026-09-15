import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, ForbiddenException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TrackingService } from './tracking.service';
import { verify } from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthActorService } from '../../fulfillment/auth-actor.service';
import { FulfillmentTransitionService } from '../../fulfillment/fulfillment-transition.service';
import { fromOrderStatus } from '../../fulfillment/fulfillment-state-machine';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/tracking',
})
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('TrackingGateway');

  constructor(private readonly trackingService: TrackingService, private readonly prisma: PrismaService, private readonly actors: AuthActorService, private readonly transitions: FulfillmentTransitionService) {}

  afterInit() {
    // Reject unauthenticated handshakes before a Socket.IO connection/room can exist.
    this.server.use((socket, next) => {
      try {
        const raw = String(socket.handshake.auth?.token || socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const payload = verify(raw, process.env.JWT_SECRET || 'dev-secret') as { sub?: string };
        if (!payload.sub) throw new Error('missing subject');
        socket.data.userId = payload.sub;
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
    this.logger.log('Tracking WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-order')
  async handleJoinOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string },
  ) {
    const fulfillment = await this.prisma.orderFulfillment.findUnique({ where: { orderV2Id: data.orderId } });
    const actor = await this.actors.resolve({ id: client.data.userId });
    if (!fulfillment || !this.canRead(actor, fulfillment)) throw new ForbiddenException('Tracking access denied');
    client.join(`order-${data.orderId}`);
    this.logger.log(`Client ${client.id} joined order-${data.orderId}`);
  }

  @SubscribeMessage('update-location')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      orderId: string;
      lat: number;
      lng: number;
      heading?: number;
      speed?: number;
    },
  ) {
    const actor = await this.actors.resolve({ id: client.data.userId, role: 'rider' });
    const fulfillment = await this.prisma.orderFulfillment.findUnique({ where: { orderV2Id: data.orderId } });
    if (!fulfillment || actor.type !== 'RIDER' || fulfillment.activeRiderId !== actor.id || !['rider_assigned','picked_up','in_transit'].includes(String(fulfillment.status))) throw new ForbiddenException('Active rider assignment required');
    if (![data.lat, data.lng, data.heading ?? 0, data.speed ?? 0].every(Number.isFinite)) throw new ForbiddenException('Invalid coordinates');
    await this.trackingService.saveLocation({
      riderId: actor.id!,
      orderId: data.orderId,
      lat: data.lat,
      lng: data.lng,
      heading: data.heading,
      speed: data.speed,
    });

    this.server.to(`order-${data.orderId}`).emit('rider-location', {
      riderId: actor.id,
      lat: data.lat,
      lng: data.lng,
      heading: data.heading,
      speed: data.speed,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('order-status-update')
  async handleOrderStatusUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string; status: string },
  ) {
    const actor = await this.actors.resolve({ id: client.data.userId, role: 'rider' });
    await this.transitions.transition({ orderV2Id: data.orderId, targetStatus: fromOrderStatus(data.status), actor });
    this.server.to(`order-${data.orderId}`).emit('status-changed', {
      orderId: data.orderId,
      status: data.status,
      timestamp: new Date().toISOString(),
    });
  }

  private canRead(actor: any, fulfillment: any) {
    return actor.type === 'SYSTEM_ADMIN' || (actor.type === 'CUSTOMER' && actor.id === fulfillment.customerId) || (actor.type === 'RIDER' && actor.id === fulfillment.activeRiderId);
  }

  @SubscribeMessage('eta-update')
  handleEtaUpdate(
    @MessageBody() data: { orderId: string; eta: string },
  ) {
    this.server.to(`order-${data.orderId}`).emit('eta-changed', {
      orderId: data.orderId,
      eta: data.eta,
    });
  }

  emitRiderStatus(riderId: string, isAvailable: boolean) {
    this.server.emit('rider-status', { riderId, isAvailable });
  }
}
