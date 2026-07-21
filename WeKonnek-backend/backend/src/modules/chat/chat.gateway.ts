import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { MessageType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('ChatGateway');

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Chat client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Chat client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string },
  ) {
    client.join(`chat-${data.orderId}`);
    this.logger.log(`Client ${client.id} joined chat-${data.orderId}`);

    const history = await this.prisma.chatMessage.findMany({
      where: { orderId: data.orderId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    client.emit('chat-history', history);
  }

  @SubscribeMessage('send-message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      orderId: string;
      senderId: string;
      senderName: string;
      message: string;
      type?: string;
    },
  ) {
    const saved = await this.prisma.chatMessage.create({
      data: {
        orderId: data.orderId,
        senderId: data.senderId,
        senderName: data.senderName,
        message: data.message,
        type: (data.type as MessageType) ?? MessageType.text,
      },
    });

    this.server.to(`chat-${data.orderId}`).emit('new-message', {
      id: saved.id,
      senderId: saved.senderId,
      senderName: saved.senderName,
      message: saved.message,
      type: saved.type,
      timestamp: saved.createdAt.toISOString(),
    });
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { orderId: string; userName: string },
  ) {
    client.to(`chat-${data.orderId}`).emit('user-typing', {
      userName: data.userName,
    });
  }
}
