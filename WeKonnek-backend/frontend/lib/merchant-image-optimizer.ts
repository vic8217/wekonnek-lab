const MB = 1024 * 1024;
export const MAX_MERCHANT_IMAGE_BYTES = 10 * MB;
const PREFERRED_MAX_BYTES = 2 * MB;
const MAX_LONG_EDGE = 1600;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function outputFileName(file: File, type: string) {
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('We could not prepare the selected image.')),
    type,
    quality,
  ));
}

function supportsWebp(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/webp').startsWith('data:image/webp');
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 255) return true;
  return false;
}

/**
 * Browser-side UX optimization only. The upload endpoint remains responsible for
 * validation and request-size protection.
 */
export async function optimizeMerchantImage(file: File): Promise<File> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error('Please choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_MERCHANT_IMAGE_BYTES) {
    throw new Error('This image exceeds the 10 MB upload limit.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("We couldn't process this image. Please try another JPEG, PNG, or WebP file.");
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_LONG_EDGE && file.size <= PREFERRED_MAX_BYTES) return file;

    const scale = Math.min(1, MAX_LONG_EDGE / longEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(bitmap, 0, 0, width, height);

    const transparent = hasTransparency(context, width, height);
    const type = supportsWebp(canvas) ? 'image/webp' : transparent ? 'image/png' : 'image/jpeg';
    let blob: Blob;
    if (type === 'image/png') {
      blob = await toBlob(canvas, type);
    } else {
      let quality = 0.82;
      blob = await toBlob(canvas, type, quality);
      // Keep useful photo detail while making a reasonable best effort to stay
      // under the preferred transfer size.
      while (blob.size > PREFERRED_MAX_BYTES && quality > 0.58) {
        quality = Math.max(0.58, quality - 0.08);
        blob = await toBlob(canvas, type, quality);
      }
    }
    return new File([blob], outputFileName(file, type), { type, lastModified: file.lastModified });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('This image')) throw error;
    throw new Error("We couldn't process this image. Please try another JPEG, PNG, or WebP file.");
  } finally {
    bitmap.close();
  }
}
