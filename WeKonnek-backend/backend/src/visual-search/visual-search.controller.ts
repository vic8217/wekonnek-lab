import { BadRequestException, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import sharp from 'sharp';
import { visualSearchConfig } from './visual-search.config';
import { VisualSearchService } from './visual-search.service';
import type { VisualSearchScope } from './visual-search.constants';

const allowed = ['image/jpeg', 'image/png', 'image/webp'];
@Controller('search')
export class VisualSearchController {
  constructor(private readonly visualSearch: VisualSearchService) {}
  @Post('visual')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: visualSearchConfig().maxBytes }, fileFilter: (_req, file, cb) => cb(null, allowed.includes(file.mimetype)) }))
  async search(@UploadedFile() image: Express.Multer.File, body: Record<string, string>) {
    if (!visualSearchConfig().enabled) throw new BadRequestException('This search option is not available right now.');
    if (!image?.buffer?.length || !allowed.includes(image.mimetype)) throw new BadRequestException('Upload a JPEG, PNG, or WebP image.');
    let processed: Buffer;
    try { const meta = await sharp(image.buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata(); if (!meta.width || !meta.height || meta.width * meta.height > 40_000_000) throw new Error(); processed = await sharp(image.buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer(); } catch { throw new BadRequestException('Upload a valid image with safe dimensions.'); }
    const scope = body.scope as VisualSearchScope;
    if (!['NEARBY', 'CITY', 'NATIONWIDE'].includes(scope)) throw new BadRequestException('Choose a valid search area.');
    const latitude = body.latitude === undefined ? undefined : Number(body.latitude); const longitude = body.longitude === undefined ? undefined : Number(body.longitude); const radiusKm = body.radiusKm === undefined ? undefined : Number(body.radiusKm);
    const results = await this.visualSearch.search({ image: processed, scope, latitude, longitude, radiusKm, city: body.city });
    return { scope, results: results.map(({ visualScore, ...result }) => ({ ...result, matchLevel: visualScore >= .9 ? 'BEST_MATCH' : visualScore >= .75 ? 'VERY_SIMILAR' : 'SIMILAR' })) };
  }
}
