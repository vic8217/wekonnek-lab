import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MEDIA_CONFIG } from './media.config';
import type { MediaConfig } from './media.config';
import { STORAGE_PROVIDER } from './storage/storage.interface';
import type { StorageProvider } from './storage/storage.interface';

@Injectable()
export class MediaCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaCleanupService.name);
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.cleanup(), 6 * 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async cleanup() {
    const cutoff = new Date(Date.now() - this.config.cleanupGraceDays * 24 * 60 * 60 * 1000);
    const assets = await this.prisma.mediaAsset.findMany({ where: { status: 'deleted', deletedAt: { lte: cutoff } }, take: 100, orderBy: { deletedAt: 'asc' } });
    for (const asset of assets) {
      try {
        await this.storage.delete(asset.objectKey);
        if (asset.thumbnailKey) await this.storage.delete(asset.thumbnailKey);
        await this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: 'purged' } });
        this.logger.log(`media_delete mediaType=${asset.mediaType} ownerType=${asset.ownerType} ownerId=${asset.ownerId} key=${asset.objectKey}`);
      } catch { this.logger.warn(`media_delete_failed key=${asset.objectKey}`); }
    }
  }
}
