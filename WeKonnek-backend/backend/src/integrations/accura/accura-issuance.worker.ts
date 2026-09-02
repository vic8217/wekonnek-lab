import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma';
import { AccuraClientService } from './accura-client.service';
import { AccuraIssuanceJobsService } from './accura-issuance-jobs.service';
import { AccuraIssuanceProcessorService } from './accura-issuance.processor';
import { ACCURA_ISSUANCE_CLOCK } from './accura-issuance.types';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
  ],
  providers: [
    AccuraClientService,
    AccuraIssuanceJobsService,
    AccuraIssuanceProcessorService,
    { provide: ACCURA_ISSUANCE_CLOCK, useValue: () => new Date() },
  ],
})
class AccuraIssuanceWorkerModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(
    AccuraIssuanceWorkerModule,
    { logger: ['log', 'warn', 'error'] },
  );
  app.enableShutdownHooks();
  const processor = app.get(AccuraIssuanceProcessorService);
  try {
    await processor.runUntilStopped();
  } finally {
    await app.close();
  }
}

void main();
