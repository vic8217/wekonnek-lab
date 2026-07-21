import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatMessage, MessageType } from '@prisma/client';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMessagesByOrder(
    orderId: string,
    limit = 50,
    before?: string,
  ): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
    const where: any = { orderId };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }

    const results = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = results.length > limit;
    const messages = results.slice(0, limit).reverse();

    return { messages, hasMore };
  }

  async sendMessage(data: {
    orderId: string;
    senderId: string;
    senderName: string;
    message: string;
    type?: MessageType;
  }): Promise<ChatMessage> {
    return this.prisma.chatMessage.create({
      data: {
        orderId: data.orderId,
        senderId: data.senderId,
        senderName: data.senderName,
        message: data.message,
        type: data.type ?? MessageType.text,
      },
    });
  }

  async getConversationsForUser(userId: string): Promise<
    {
      orderId: string;
      lastMessage: string;
      lastMessageAt: Date;
      unreadHint: boolean;
    }[]
  > {
    const conversations = await this.prisma.$queryRaw<
      { orderId: string; lastMessageAt: Date }[]
    >`
      SELECT order_id AS "orderId", MAX(created_at) AS "lastMessageAt"
      FROM chat_messages
      WHERE order_id IN (
        SELECT DISTINCT order_id FROM chat_messages WHERE sender_id = ${userId}
      )
      GROUP BY order_id
      ORDER BY "lastMessageAt" DESC
    `;

    const result: { orderId: string; lastMessage: string; lastMessageAt: Date; unreadHint: boolean }[] = [];
    for (const conv of conversations) {
      const lastMsg = await this.prisma.chatMessage.findFirst({
        where: { orderId: conv.orderId },
        orderBy: { createdAt: 'desc' },
      });

      result.push({
        orderId: conv.orderId,
        lastMessage: lastMsg?.message ?? '',
        lastMessageAt: conv.lastMessageAt,
        unreadHint: lastMsg?.senderId !== userId,
      });
    }

    return result;
  }

  async countMessages(orderId: string): Promise<number> {
    return this.prisma.chatMessage.count({ where: { orderId } });
  }
}
