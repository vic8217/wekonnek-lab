import { BadRequestException, Body, Controller, Delete, Param, Post, Req, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MediaService } from './media.service';
import type { MediaAssetResult } from './media.types';

const uploadOptions = {
  storage: memoryStorage(),
  // Keep Multer's early rejection aligned with the media policies and proxy.
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    callback(allowed.includes(file.mimetype) ? null : new BadRequestException('Unsupported upload type'), allowed.includes(file.mimetype));
  },
};

@ApiTags('media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Process and store an authenticated media upload' })
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async upload(@Req() req: any, @UploadedFile() file: Express.Multer.File, @Body('type') rawType: string, @Body('resourceId') resourceId?: string, @Body('previousMediaId') previousMediaId?: string) {
    if (!file) throw new BadRequestException('No file uploaded');
    const mediaType = this.media.normalizeType(rawType);
    const owner = await this.media.resolveOwner(req.user, mediaType, resourceId);
    const asset = previousMediaId && mediaType !== 'document'
      ? await this.media.replaceImage(previousMediaId, file, mediaType, owner, req.user.id)
      : mediaType === 'document'
      ? await this.media.uploadDocument(file, owner, req.user.id)
      : await this.media.uploadImage(file, mediaType, owner, req.user.id);
    return { ...asset, mediaId: asset.id, publicUrl: asset.url };
  }

  @Post('multiple')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Process and store up to ten authenticated media uploads' })
  @UseInterceptors(FilesInterceptor('files', 10, uploadOptions))
  async uploadMultiple(@Req() req: any, @UploadedFiles() files: Express.Multer.File[], @Body('type') rawType: string, @Body('resourceId') resourceId?: string) {
    if (!files?.length) throw new BadRequestException('No files uploaded');
    const mediaType = this.media.normalizeType(rawType);
    const owner = await this.media.resolveOwner(req.user, mediaType, resourceId);
    const assets: MediaAssetResult[] = [];
    try {
      for (const file of files) {
        assets.push(mediaType === 'document'
          ? await this.media.uploadDocument(file, owner, req.user.id)
          : await this.media.uploadImage(file, mediaType, owner, req.user.id));
      }
    } catch (error) {
      await Promise.allSettled(assets.map(asset => this.media.softDeleteMedia(asset.id, req.user.id)));
      throw error;
    }
    return { assets, urls: assets.map(asset => asset.url), thumbnailUrls: assets.map(asset => asset.thumbnailUrl) };
  }

  @Delete('media/:id')
  softDelete(@Req() req: any, @Param('id') id: string) {
    return this.media.softDeleteMedia(id, req.user.id);
  }
}
