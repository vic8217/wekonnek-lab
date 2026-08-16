import { StorageUploadInput, StorageUploadResult } from '../media.types';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  delete(key: string): Promise<void>;
  exists?(key: string): Promise<boolean>;
  getPublicUrl(key: string): string;
}
