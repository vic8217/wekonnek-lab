import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffPostDto } from './dto/create-staff-post.dto';
import { UpdateStaffPostDto } from './dto/update-staff-post.dto';

@Injectable()
export class StaffPostsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createStaffPostDto: CreateStaffPostDto) {
    return await this.prisma.staffPost.create({
      data: {
        ...createStaffPostDto,
        expiresAt: createStaffPostDto.expiresAt
          ? new Date(createStaffPostDto.expiresAt)
          : null,
      } as any,
    });
  }

  async findAll() {
    return await this.prisma.staffPost.findMany({
      include: { merchant: true, category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActive() {
    const now = new Date();
    return await this.prisma.staffPost.findMany({
      where: {
        isActive: true,
        expiresAt: { gt: now },
      },
      include: { merchant: true, category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findExpired() {
    const now = new Date();
    return await this.prisma.staffPost.findMany({
      where: {
        OR: [
          { isActive: false },
          { expiresAt: { lt: now } },
        ],
      },
      include: { merchant: true, category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const post = await this.prisma.staffPost.findUnique({
      where: { id },
      include: { merchant: true, category: true },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }

    await this.prisma.staffPost.update({
      where: { id },
      data: { viewsCount: (post.viewsCount || 0) + 1 },
    });

    return { ...post, viewsCount: (post.viewsCount || 0) + 1 };
  }

  async update(id: number, updateStaffPostDto: UpdateStaffPostDto) {
    await this.findOne(id);

    const data: any = { ...updateStaffPostDto };
    if (data.expiresAt) {
      data.expiresAt = new Date(data.expiresAt);
    }

    return await this.prisma.staffPost.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.staffPost.delete({ where: { id } });
  }

  async getStats() {
    const now = new Date();

    const [activePosts, expiredPosts, allPosts] = await Promise.all([
      this.prisma.staffPost.count({
        where: {
          isActive: true,
          expiresAt: { gt: now },
        },
      }),
      this.prisma.staffPost.count({
        where: {
          OR: [
            { isActive: false },
            { expiresAt: { lt: now } },
          ],
        },
      }),
      this.prisma.staffPost.findMany({
        select: { viewsCount: true },
      }),
    ]);

    const totalViews = allPosts.reduce((sum, post) => sum + (post.viewsCount || 0), 0);

    return {
      activePosts,
      expiredPosts,
      totalViews,
    };
  }
}
