import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { MediaService } from '../modules/media/media.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import { listingInquiryNotificationUrl } from '../modules/notifications/notification-routes';

type InquiryType = 'BAZAAR' | 'PROPERTY';

@Injectable()
export class ListingInquiriesService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly notifications: NotificationsService) {}

  async summary(userId: string) {
    await Promise.all([
      this.prisma.bazaarListing.updateMany({ where: { sellerId: userId, status: 'active', expiresAt: { lte: new Date() } }, data: { status: 'expired' } }),
      this.prisma.propertyListing.updateMany({ where: { ownerId: userId, listingStatus: 'ACTIVE', expiresAt: { lte: new Date() } }, data: { listingStatus: 'EXPIRED' } }),
    ]);
    const inquiries = (this.prisma as any).listingInquiry;
    const [bazaarActive, bazaarExpired, propertyActive, propertyExpired, bazaarUnread, propertyUnread] = await Promise.all([
      this.prisma.bazaarListing.count({ where: { sellerId: userId, status: 'active' } }),
      this.prisma.bazaarListing.count({ where: { sellerId: userId, status: 'expired' } }),
      this.prisma.propertyListing.count({ where: { ownerId: userId, listingStatus: 'ACTIVE' } }),
      this.prisma.propertyListing.count({ where: { ownerId: userId, listingStatus: 'EXPIRED' } }),
      inquiries.count({ where: { listingOwnerId: userId, listingType: 'BAZAAR', readAt: null } }),
      inquiries.count({ where: { listingOwnerId: userId, listingType: 'PROPERTY', readAt: null } }),
    ]);
    return {
      bazaar: { active: bazaarActive, expired: bazaarExpired, unreadInquiries: bazaarUnread },
      property: { active: propertyActive, expired: propertyExpired, unreadInquiries: propertyUnread },
    };
  }

  async received(userId: string, requestedType?: string) {
    const type = this.type(requestedType, false);
    const rows = await (this.prisma as any).listingInquiry.findMany({
      where: { listingOwnerId: userId, ...(type ? { listingType: type } : {}) },
      include: { inquirer: { select: { id: true, firstName: true, lastName: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map(async (row: any) => {
      if (row.listingType === 'BAZAAR') {
        const listing = await this.prisma.bazaarListing.findUnique({ where: { id: row.listingId }, select: { id: true, title: true, status: true, imageUrls: true } });
        const imageUrls = Array.isArray(listing?.imageUrls) ? listing.imageUrls.filter((url): url is string => typeof url === 'string') : [];
        const thumbnails = await this.media.thumbnailMap(imageUrls);
        return { ...row, listing: listing ? { ...listing, imageUrls, thumbnailUrls: imageUrls.map(url => thumbnails.get(url) || url) } : null };
      }
      const listing = await this.prisma.propertyListing.findUnique({ where: { id: row.listingId }, select: { id: true, title: true, listingStatus: true, images: { take: 1, orderBy: { sortOrder: 'asc' } } } });
      const imageUrls = listing?.images.map(image => image.imageUrl) || [];
      const thumbnails = await this.media.thumbnailMap(imageUrls);
      return { ...row, listing: listing ? { ...listing, status: listing.listingStatus, imageUrls, thumbnailUrls: imageUrls.map(url => thumbnails.get(url) || url) } : null };
    }));
  }

  async create(userId: string, requestedType: string, listingId: string, body: any) {
    const type = this.type(requestedType, true)!;
    const message = String(body?.message || '').trim();
    if (message.length < 2 || message.length > 2000) throw new BadRequestException('Inquiry message must be between 2 and 2,000 characters');
    const ownerId = type === 'BAZAAR'
      ? (await this.prisma.bazaarListing.findFirst({ where: { id: listingId, status: 'active' }, select: { sellerId: true } }))?.sellerId
      : (await this.prisma.propertyListing.findFirst({ where: { id: listingId, listingStatus: { in: ['ACTIVE', 'RESERVED'] } }, select: { ownerId: true } }))?.ownerId;
    if (!ownerId) throw new NotFoundException('Listing not found');
    if (ownerId === userId) throw new BadRequestException('You cannot inquire about your own listing');
    const inquiry = await (this.prisma as any).listingInquiry.create({ data: { listingId, listingType: type, listingOwnerId: ownerId, inquirerId: userId, message } });
    await this.notifications.notify({
      userId: ownerId,
      title: `New ${type === 'BAZAAR' ? 'Bazaar' : 'Property'} inquiry`,
      body: 'Someone sent an inquiry about your listing.',
      type: NotificationType.system,
      data: { kind: `${type.toLowerCase()}_inquiry`, inquiryId: String(inquiry.id), listingId, url: listingInquiryNotificationUrl(type, String(inquiry.id)) },
    }).catch(() => undefined);
    return inquiry;
  }

  async markRead(userId: string, id: string) {
    const inquiry = await (this.prisma as any).listingInquiry.findUnique({ where: { id } });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    if (inquiry.listingOwnerId !== userId) throw new ForbiddenException('This inquiry belongs to another seller');
    return (this.prisma as any).listingInquiry.update({ where: { id }, data: { readAt: inquiry.readAt || new Date() } });
  }

  private type(value?: string, required = true): InquiryType | undefined {
    if (!value && !required) return undefined;
    const type = String(value || '').toUpperCase();
    if (type !== 'BAZAAR' && type !== 'PROPERTY') throw new BadRequestException('Inquiry type must be bazaar or property');
    return type;
  }
}
