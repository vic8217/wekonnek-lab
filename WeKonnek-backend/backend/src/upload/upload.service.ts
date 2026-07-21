import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class UploadService {
  private readonly uploadDir: string;

  constructor() {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadFileToStorage(
    file: Express.Multer.File,
    type: string,
  ): Promise<string> {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = file.originalname.split('.').pop();
    const filename = `${type}-${uniqueSuffix}.${ext}`;
    const filepath = path.join(this.uploadDir, filename);

    fs.writeFileSync(filepath, file.buffer);

    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/api/uploads/${filename}`;
  }

  async getFileUrl(filename: string): Promise<string> {
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/api/uploads/${filename}`;
  }
}
