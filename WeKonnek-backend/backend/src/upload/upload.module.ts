import { Module } from '@nestjs/common';
import { MediaModule } from '../modules/media/media.module';

// Compatibility wrapper retained for AppModule and older module imports.
// Upload routes and implementation are provided exclusively by MediaModule.
@Module({
  imports: [MediaModule],
  exports: [MediaModule],
})
export class UploadModule {}
