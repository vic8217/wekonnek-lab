import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function serializeReview(r: any) {
  if (!r) return r;
  const user = r.user;
  const firstName = user?.firstName || 'Customer';
  const lastName = user?.lastName || '';
  return {
    id: r.id,
    user_id: r.userId,
    userId: r.userId,
    merchant_id: r.merchantId,
    merchantId: r.merchantId,
    product_id: r.productId,
    productId: r.productId,
    rating: r.rating,
    review_text: r.reviewText,
    reviewText: r.reviewText,
    response_text: r.responseText,
    responseText: r.responseText,
    responded_at: r.respondedAt,
    respondedAt: r.respondedAt,
    created_at: r.createdAt,
    createdAt: r.createdAt,
    updated_at: r.updatedAt,
    updatedAt: r.updatedAt,
    user_first_name: firstName,
    user_last_name: lastName,
    product_name: r.product?.name || 'General Review',
    merchant_name: r.merchant?.name || '',
  };
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    input: {
      merchant_id?: number;
      merchantId?: number;
      product_id?: number;
      productId?: number;
      rating?: number;
      review_text?: string;
      reviewText?: string;
    },
  ) {
    const merchantId = input.merchant_id ?? input.merchantId;
    const productId = input.product_id ?? input.productId;
    const rating = input.rating;
    const reviewText = input.review_text ?? input.reviewText ?? '';

    if (!rating || rating < 1 || rating > 5)
      throw new BadRequestException('rating must be between 1 and 5');

    const review = await this.prisma.review.create({
      data: {
        userId,
        merchantId: merchantId ? Number(merchantId) : null,
        productId: productId ? Number(productId) : null,
        rating: Number(rating),
        reviewText,
      },
      include: { merchant: true, product: true },
    });

    if (merchantId) {
      const agg = await this.prisma.review.aggregate({
        where: { merchantId: Number(merchantId) },
        _avg: { rating: true },
        _count: { id: true },
      });
      await this.prisma.merchant.update({
        where: { id: Number(merchantId) },
        data: {
          rating: agg._avg.rating ?? 0,
          totalReviews: agg._count.id,
        },
      });
    }

    return serializeReview(review);
  }

  async findAll(opts: {
    userId?: string;
    merchantId?: number;
    productId?: number;
  }) {
    const where: any = {};
    if (opts.merchantId) {
      where.merchantId = Number(opts.merchantId);
    } else if (opts.productId) {
      where.productId = Number(opts.productId);
    } else if (opts.userId) {
      where.userId = opts.userId;
    }

    const reviews = await this.prisma.review.findMany({
      where,
      include: { merchant: true, product: true },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [...new Set(reviews.map((r) => r.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return reviews.map((r) =>
      serializeReview({ ...r, user: byId.get(r.userId) }),
    );
  }

  async findById(id: number) {
    const review = await this.prisma.review.findUnique({
      where: { id: Number(id) },
      include: { merchant: true, product: true },
    });
    if (!review) throw new NotFoundException('Review not found');

    const user = await this.prisma.user.findUnique({
      where: { id: review.userId },
      select: { id: true, firstName: true, lastName: true },
    });
    return serializeReview({ ...review, user });
  }

  async respond(id: number, responseText: string) {
    if (!responseText?.trim())
      throw new BadRequestException('response_text is required');

    const existing = await this.prisma.review.findUnique({
      where: { id: Number(id) },
    });
    if (!existing) throw new NotFoundException('Review not found');

    const review = await this.prisma.review.update({
      where: { id: Number(id) },
      data: {
        responseText: responseText.trim(),
        respondedAt: new Date(),
      },
      include: { merchant: true, product: true },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: review.userId },
      select: { id: true, firstName: true, lastName: true },
    });
    return serializeReview({ ...review, user });
  }
}
