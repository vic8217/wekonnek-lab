import { ConfigService } from '@nestjs/config';

export type MediaConfig = {
  region: string;
  bucket: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl: string;
  environment: string;
  maxUploadBytes: number;
  cleanupGraceDays: number;
};

export const MEDIA_CONFIG = Symbol('MEDIA_CONFIG');

export function createMediaConfig(config: ConfigService): MediaConfig {
  const region = config.get<string>('DO_SPACES_REGION')?.trim() || '';
  const bucket = config.get<string>('DO_SPACES_BUCKET')?.trim() || '';
  const endpoint = config.get<string>('DO_SPACES_ENDPOINT')?.trim().replace(/\/$/, '') || '';
  const accessKey = config.get<string>('DO_SPACES_ACCESS_KEY')?.trim() || '';
  const secretKey = config.get<string>('DO_SPACES_SECRET_KEY')?.trim() || '';
  if (config.get('NODE_ENV') !== 'test' && (!region || !bucket || !endpoint || !accessKey || !secretKey)) {
    throw new Error('DigitalOcean Spaces media configuration is incomplete');
  }
  const cdn = config.get<string>('DO_SPACES_CDN_URL')?.trim().replace(/\/$/, '');
  const maxMb = Number(config.get<string>('MEDIA_MAX_UPLOAD_MB') || 10);
  return {
    region, bucket, endpoint, accessKey, secretKey,
    publicBaseUrl: cdn || `https://${bucket}.${region}.digitaloceanspaces.com`,
    environment: (config.get<string>('MEDIA_ENVIRONMENT') || 'lab').replace(/[^a-z0-9_-]/gi, '-').toLowerCase(),
    maxUploadBytes: Math.max(1, Math.min(10, Number.isFinite(maxMb) ? maxMb : 10)) * 1024 * 1024,
    cleanupGraceDays: Number(config.get<string>('MEDIA_CLEANUP_GRACE_DAYS') || ((config.get<string>('MEDIA_ENVIRONMENT') || 'lab') === 'production' ? 30 : 7)),
  };
}
