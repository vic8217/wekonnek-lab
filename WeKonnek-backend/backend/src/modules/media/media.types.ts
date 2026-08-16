export type MediaType =
  | 'merchant-product' | 'menu-item' | 'merchant-logo' | 'merchant-banner'
  | 'customer-review' | 'bazaar' | 'property' | 'profile' | 'category'
  | 'onboarding' | 'document';

export type MediaPolicy = {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  quality: number;
  thumbnail?: { width: number; height: number; quality: number };
};

export type MediaOwner = { ownerType: string; ownerId: string; keyOwner: string };

export type StorageUploadInput = {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
};

export type StorageUploadResult = { key: string; url: string };

export type MediaAssetResult = {
  id: string;
  mediaType: string;
  objectKey: string;
  thumbnailKey: string | null;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
};
