import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessageType } from '@prisma/client';

@ApiTags('Chat')
@Controller('chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get chat messages for an order' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false, description: 'ISO date cursor for pagination' })
  getMessages(
    @Param('orderId') orderId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.chatService.getMessagesByOrder(
      orderId,
      limit ? parseInt(limit) : 50,
      before,
    );
  }

  @Post('order/:orderId')
  @ApiOperation({ summary: 'Send a message via REST (fallback if WebSocket unavailable)' })
  sendMessage(
    @Param('orderId') orderId: string,
    @Req() req: any,
    @Body() body: { message: string; type?: MessageType },
  ) {
    return this.chatService.sendMessage({
      orderId,
      senderId: req.user.id,
      senderName: req.user.firstName
        ? `${req.user.firstName} ${req.user.lastName ?? ''}`.trim()
        : req.user.phone,
      message: body.message,
      type: body.type,
    });
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List all chat conversations for the current user' })
  getConversations(@Req() req: any) {
    return this.chatService.getConversationsForUser(req.user.id);
  }
}
