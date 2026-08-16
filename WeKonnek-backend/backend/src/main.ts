import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Enable CORS for frontend apps (Flutter, PWA)
  app.enableCors({
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',')
      : true, // Allow all origins in development
    credentials: true,
  });

  // Legacy read compatibility only. New uploads always use object storage.
  // Both historical URL shapes remain readable without moving local files.
  for (const prefix of ['/uploads', '/api/uploads']) {
    app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix });
  }

  // Global exception filter — consistent JSON error responses
  app.useGlobalFilters(new AllExceptionsFilter());

  // Validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Set global prefix
  app.setGlobalPrefix('api');

  // ── Swagger API Docs ──────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('WeKonnek Unified Backend API')
    .setDescription(
      'WeKonnek unified backend — Auth, Users, Orders, Wallet, Tracking, Chat, Zones, Invoices, ' +
      'Categories, Merchants, Products, Sub-Categories, Staff Posts, and File Upload.\n\n' +
      'This single backend serves the WeKonnek customer app, provider app, and WeKonnek PWA dashboard.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    // WeKonnek Catalog
    .addTag('categories', 'Product categories management')
    .addTag('sub-categories', 'Sub-categories under main categories')
    .addTag('merchants', 'Merchant/store management and search')
    .addTag('products', 'Product catalog per merchant')
    .addTag('staff-posts', 'Staff announcements and posts')
    .addTag('upload', 'File upload (images, documents)')
    // WeKonnek Core
    .addTag('Auth', 'Authentication (OTP, JWT, register, login)')
    .addTag('Users', 'User profiles and management')
    .addTag('Stores', 'Physical store locations')
    .addTag('Store Products', 'Store-specific products')
    .addTag('Orders', 'Order management and lifecycle')
    .addTag('Addresses', 'User saved addresses')
    .addTag('Wallet', 'WeKonnek Pay e-wallet')
    .addTag('Zones', 'Delivery zones and fee calculation')
    .addTag('Invoices / E-Receipts', 'BIR-compliant e-invoices')
    .addServer(`http://localhost:${process.env.PORT || 3000}`, 'Local Development')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`
╔══════════════════════════════════════════════════════╗
║   WeKonnek Unified Backend API                       ║
║   Running on: http://localhost:${port}/api                ║
║   API Docs:   http://localhost:${port}/docs               ║
║                                                      ║
║   WebSocket:  /tracking  (real-time rider location)  ║
║               /chat      (in-app messaging)          ║
╚══════════════════════════════════════════════════════╝
  `);
}
bootstrap();
