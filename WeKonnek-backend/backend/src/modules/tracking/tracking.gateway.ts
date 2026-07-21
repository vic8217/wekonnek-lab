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
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TrackingService } from './tracking.service';

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

  constructor(private readonly trackingService: TrackingService) {}

  afterInit() {
    this.logger.log('Tracking WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-order')
  handleJoinOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string },
  ) {
    client.join(`order-${data.orderId}`);
    this.logger.log(`Client ${client.id} joined order-${data.orderId}`);
  }

  @SubscribeMessage('update-location')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      orderId: string;
      riderId: string;
      lat: number;
      lng: number;
      heading?: number;
      speed?: number;
    },
  ) {
    await this.trackingService.saveLocation({
      riderId: data.riderId,
      orderId: data.orderId,
      lat: data.lat,
      lng: data.lng,
      heading: data.heading,
      speed: data.speed,
    });

    this.server.to(`order-${data.orderId}`).emit('rider-location', {
      riderId: data.riderId,
      lat: data.lat,
      lng: data.lng,
      heading: data.heading,
      speed: data.speed,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('order-status-update')
  handleOrderStatusUpdate(
    @MessageBody() data: { orderId: string; status: string },
  ) {
    this.server.to(`order-${data.orderId}`).emit('status-changed', {
      orderId: data.orderId,
      status: data.status,
      timestamp: new Date().toISOString(),
    });
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
