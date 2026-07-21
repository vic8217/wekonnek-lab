import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { VercelRequest, VercelResponse } from '@vercel/node';

let cachedApp: NestExpressApplication;
let isInitializing = false;

async function bootstrap() {
  if (cachedApp) {
    return cachedApp;
  }

  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return cachedApp;
  }

  isInitializing = true;
  
  try {
    console.log('🚀 Starting NestJS application...');
    console.log('Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set',
      DB_HOST: process.env.DB_HOST || 'Not set',
    });

    cachedApp = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log'],
    });

    console.log('✅ NestJS app created');

    // Enable CORS for frontend
    cachedApp.enableCors({
      origin: process.env.FRONTEND_URL 
        ? process.env.FRONTEND_URL.split(',')
        : true,
      credentials: true,
    });

    console.log('✅ CORS enabled');

    // Enable validation pipes
    cachedApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    console.log('✅ Validation pipes enabled');

    // Set global prefix
    cachedApp.setGlobalPrefix('api');

    console.log('✅ Global prefix set to /api');

    await cachedApp.init();
    
    console.log('✅ NestJS app initialized successfully');
    
    return cachedApp;
  } catch (error) {
    console.error('❌ Error initializing NestJS app:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  } finally {
    isInitializing = false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  
  try {
    const url = req.url || '/';
    console.log(`📥 Request received: ${req.method} ${url}`);
    
    // Simple test endpoint (before any initialization)
    if (url === '/test' || url === '/api/test') {
      return res.status(200).json({
        status: 'ok',
        message: 'API handler is working',
        timestamp: new Date().toISOString(),
        method: req.method,
        url: url,
      });
    }
    
    // Health check endpoint (before any initialization)
    if (url === '/health' || url === '/api/health') {
      return res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        database: {
          configured: !!(process.env.DATABASE_URL || process.env.DB_HOST),
        },
      });
    }

    console.log('🔄 Initializing NestJS app...');
    const app = await bootstrap();
    console.log('✅ NestJS app ready');
    
    const expressApp = app.getHttpAdapter().getInstance();
    
    // Handle the request with Express app
    expressApp(req, res);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Error after ${duration}ms:`, error);
    
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      // Try to send error response if not already sent
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Internal Server Error',
          message: error.message,
          name: error.name,
          timestamp: new Date().toISOString(),
          duration: `${duration}ms`,
        });
      }
    } else {
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'Unknown error',
          timestamp: new Date().toISOString(),
          duration: `${duration}ms`,
        });
      }
    }
  }
}
