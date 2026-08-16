import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3StorageProvider } from './s3-storage.provider';

describe('S3StorageProvider', () => {
  const provider = new S3StorageProvider({
    region: 'sgp1', bucket: 'test-bucket', endpoint: 'https://sgp1.digitaloceanspaces.com',
    accessKey: 'test', secretKey: 'test', publicBaseUrl: 'https://cdn.example.test', environment: 'lab', maxUploadBytes: 1, cleanupGraceDays: 7,
  });
  const send = jest.fn().mockResolvedValue({});

  beforeEach(() => { send.mockClear(); (provider as any).client.send = send; });

  it('uploads immutable WebP objects to the configured bucket', async () => {
    await provider.upload({ key: 'lab/test.webp', body: Buffer.from('webp'), contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
    expect(send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'lab/test.webp', ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' });
  });

  it('deletes by object key', async () => {
    await provider.delete('lab/test.webp');
    expect(send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'lab/test.webp' });
  });
});
