import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface ImageUploadOptions {
  bucket: string;
  folder?: string;
  maxBytes?: number;
  accept?: string[];
}

const DEFAULT_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export async function uploadImage(
  file: File,
  options: ImageUploadOptions,
): Promise<string> {
  const accept = options.accept ?? DEFAULT_ACCEPT;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;

  if (!accept.includes(file.type)) {
    throw new Error(
      `Unsupported file type ${file.type || 'unknown'}. Allowed: ${accept.join(', ')}`,
    );
  }
  if (file.size > maxBytes) {
    throw new Error(
      `File is too large (max ${(maxBytes / (1024 * 1024)).toFixed(1)} MB).`,
    );
  }

  const formData = new FormData();
  formData.append('file', file);
  if (options.bucket) formData.append('bucket', options.bucket);
  if (options.folder) formData.append('folder', options.folder);
  formData.append('type', 'category');

  const token = getToken();
  const res = await fetch(`${API}/api/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Upload failed');
  }

  const data = await res.json();
  return data.url || data.publicUrl;
}
