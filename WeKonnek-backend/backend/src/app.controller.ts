import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      database: {
        configured: !!(process.env.DATABASE_URL || process.env.DB_HOST),
        hasUrl: !!process.env.DATABASE_URL,
        hasCredentials: !!(process.env.DB_HOST && process.env.DB_USERNAME),
      },
      version: '1.0.0',
    };
  }
}
