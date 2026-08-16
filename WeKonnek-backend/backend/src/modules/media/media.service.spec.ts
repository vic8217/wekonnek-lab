import sharp from 'sharp';
import { MediaService } from './media.service';
import type { MediaConfig } from './media.config';

describe('MediaService', () => {
  const config: MediaConfig = {
    region: 'test', bucket: 'bucket', endpoint: 'https://example.invalid', accessKey: 'x', secretKey: 'y',
    publicBaseUrl: 'https://media.example.test', environment: 'lab', maxUploadBytes: 15 * 1024 * 1024, cleanupGraceDays: 7,
  };
  const owner = { ownerType: 'user', ownerId: '00000000-0000-4000-8000-000000000001', keyOwner: 'user-test' };
  let uploads: Array<{ key: string; body: Buffer; contentType: string; cacheControl?: string }>;
  let storage: any;
  let prisma: any;
  let service: MediaService;

  beforeEach(() => {
    uploads = [];
    storage = {
      upload: jest.fn(async (input: any) => { uploads.push(input); return { key: input.key, url: `https://media.example.test/${input.key}` }; }),
      delete: jest.fn(), getPublicUrl: (key: string) => `https://media.example.test/${key}`,
    };
    prisma = { mediaAsset: { create: jest.fn(async ({ data }: any) => ({ id: 'asset-id', ...data })) } };
    service = new MediaService(prisma, storage, config);
  });

  const file = (buffer: Buffer, mimetype: string): Express.Multer.File => ({ buffer, mimetype, size: buffer.length, originalname: 'untrusted.name', fieldname: 'file', encoding: '7bit', stream: undefined as any, destination: '', filename: '', path: '' });

  it.each([['JPEG', 'jpeg', 'image/jpeg'], ['PNG', 'png', 'image/png']] as const)('converts %s to WebP and generates a thumbnail', async (_label, format, mimetype) => {
    const input = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#336699' } })[format]().toBuffer();
    const result = await service.uploadImage(file(input, mimetype), 'merchant-product', owner, owner.ownerId);
    expect(uploads).toHaveLength(2);
    expect(uploads.every(item => item.contentType === 'image/webp')).toBe(true);
    expect(uploads[0].key).toMatch(/^lab\/merchant-product\/user-test\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);
    expect(uploads[1].key).toMatch(/-thumb\.webp$/);
    expect(await sharp(uploads[0].body).metadata()).toMatchObject({ format: 'webp', width: 1200, height: 900 });
    expect(await sharp(uploads[1].body).metadata()).toMatchObject({ format: 'webp', width: 400, height: 400 });
    expect(result.thumbnailUrl).toContain('-thumb.webp');
  });

  it('rejects oversized uploads', async () => {
    await expect(service.uploadImage(file(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/jpeg'), 'merchant-product', owner, owner.ownerId)).rejects.toThrow('size limit');
  });

  it('rejects invalid image content', async () => {
    await expect(service.uploadImage(file(Buffer.from('not an image'), 'image/jpeg'), 'merchant-product', owner, owner.ownerId)).rejects.toThrow('valid supported image');
  });

  it('rejects images over the pixel limit', async () => {
    const input = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#fff' } }).png().toBuffer();
    await expect(service.uploadImage(file(input, 'image/png'), 'property', owner, owner.ownerId)).rejects.toThrow(/valid supported image|dimensions are too large/);
  });

  it('removes uploaded objects when the database association fails', async () => {
    prisma.mediaAsset.create.mockRejectedValueOnce(new Error('database unavailable'));
    const input = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await expect(service.uploadImage(file(input, 'image/jpeg'), 'profile', owner, owner.ownerId)).rejects.toThrow('database unavailable');
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it.each([['JPEG', 'jpeg', 'image/jpeg'], ['PNG', 'png', 'image/png']] as const)('accepts a %s document image and normalizes it to WebP without a thumbnail', async (_label, format, mimetype) => {
    const input = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#445566' } })[format]().toBuffer();
    const result = await service.uploadDocument(file(input, mimetype), owner, owner.ownerId);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ contentType: 'image/webp', cacheControl: 'private, max-age=3600' });
    expect(uploads[0].key).toMatch(/^lab\/documents\/user-test\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);
    expect(await sharp(uploads[0].body).metadata()).toMatchObject({ format: 'webp', width: 900, height: 600 });
    expect(result).toMatchObject({ mimeType: 'image/webp' });
    expect(result).not.toHaveProperty('thumbnailKey');
    expect(result).not.toHaveProperty('thumbnailUrl');
  });

  it('accepts a valid PDF document and preserves its bytes and MIME type without a thumbnail', async () => {
    const input = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
    const result = await service.uploadDocument(file(input, 'application/pdf'), owner, owner.ownerId);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ body: input, contentType: 'application/pdf', cacheControl: 'private, max-age=3600' });
    expect(uploads[0].key).toMatch(/^lab\/documents\/user-test\/\d{4}\/\d{2}\/[0-9a-f-]+\.pdf$/);
    expect(result).toMatchObject({ mimeType: 'application/pdf' });
    expect(result).not.toHaveProperty('thumbnailKey');
    expect(result).not.toHaveProperty('thumbnailUrl');
  });

  it('rejects a document whose declared type does not match valid content', async () => {
    await expect(service.uploadDocument(file(Buffer.from('not a pdf'), 'application/pdf'), owner, owner.ownerId)).rejects.toThrow('valid PDF');
    await expect(service.uploadDocument(file(Buffer.from('not an image'), 'image/png'), owner, owner.ownerId)).rejects.toThrow('valid supported document image');
  });

  it('rejects merchant media when the authenticated user has no merchant membership', async () => {
    prisma.merchant = { findFirst: jest.fn().mockResolvedValue(null) };
    await expect(service.resolveOwner({ id: owner.ownerId, role: 'customer' }, 'merchant-product')).rejects.toThrow('No merchant access');
  });
});
