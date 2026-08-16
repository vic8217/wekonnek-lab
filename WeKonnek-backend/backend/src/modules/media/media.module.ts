import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMediaConfig, MEDIA_CONFIG } from './media.config';
import { MediaController } from './media.controller';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaService } from './media.service';
import { S3StorageProvider } from './storage/s3-storage.provider';
import { STORAGE_PROVIDER } from './storage/storage.interface';

@Global()
@Module({
  controllers: [MediaController],
  providers: [
    { provide: MEDIA_CONFIG, inject: [ConfigService], useFactory: createMediaConfig },
    S3StorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: S3StorageProvider },
    MediaService,
    MediaCleanupService,
  ],
  exports: [MediaService, STORAGE_PROVIDER],
})
export class MediaModule {}
