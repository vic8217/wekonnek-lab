import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MEDIA_CONFIG } from '../media.config';
import type { MediaConfig } from '../media.config';
import type { StorageUploadInput, StorageUploadResult } from '../media.types';
import type { StorageProvider } from './storage.interface';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly logger = new Logger(S3StorageProvider.name);

  constructor(@Inject(MEDIA_CONFIG) private readonly config: MediaConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      forcePathStyle: false,
    });
  }

  getPublicUrl(key: string) {
    return `${this.config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.cacheControl,
        // Media objects are intentionally public while bucket listing remains
        // restricted. Without an object ACL, Spaces stores them privately and
        // browser/CDN requests receive 403 responses.
        ACL: 'public-read',
      }));
      return { key: input.key, url: this.getPublicUrl(input.key) };
    } catch {
      this.logger.error(`Object upload failed key=${input.key}`);
      throw new ServiceUnavailableException('Media storage is temporarily unavailable');
    }
  }

  async delete(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch {
      this.logger.warn(`Object cleanup failed key=${key}`);
      throw new ServiceUnavailableException('Media cleanup is temporarily unavailable');
    }
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch { return false; }
  }
}
