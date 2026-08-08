import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PropertyListingStatus, PropertyPricePeriod, PropertySellerType, PropertyTransactionType, PropertyViewingStatus } from '@prisma/client';
import { PrismaService } from '../prisma';

const PUBLIC = [PropertyListingStatus.ACTIVE, PropertyListingStatus.RESERVED];
const REPORT_REASONS = ['Incorrect information', 'Suspected scam', 'Duplicate listing', 'Property no longer available', 'Misleading photos', 'Wrong price', 'Other'];

@Injectable()
export class PropertyService {
  constructor(private readonly prisma: PrismaService) {}

  async types(includeInactive = false) {
    return this.prisma.propertyType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ groupName: 'asc' }, { displayOrder: 'asc' }] });
  }

  async browse(q: any) {
    await this.expire();
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(48, Math.max(1, Number(q.limit) || 12));
    const where: any = { listingStatus: { in: PUBLIC } };
    if (q.transactionType && Object.values(PropertyTransactionType).includes(q.transactionType)) where.transactionType = q.transactionType;
    if (q.propertyTypeId) where.propertyTypeId = q.propertyTypeId;
    if (q.city) where.city = { contains: String(q.city), mode: 'insensitive' };
    if (q.barangay) where.barangay = { contains: String(q.barangay), mode: 'insensitive' };
    if (q.keyword) where.OR = ['title', 'description', 'city', 'barangay'].map(field => ({ [field]: { contains: String(q.keyword).trim(), mode: 'insensitive' } }));
    const price: any = {}; if (q.minPrice !== undefined && q.minPrice !== '') price.gte = this.nonNegative(q.minPrice, 'Minimum price'); if (q.maxPrice !== undefined && q.maxPrice !== '') price.lte = this.nonNegative(q.maxPrice, 'Maximum price'); if (Object.keys(price).length) where.price = price;
    for (const key of ['bedrooms', 'parkingSpaces']) if (q[key] !== undefined && q[key] !== '') where[key] = { gte: Math.floor(this.nonNegative(q[key], key)) };
    if (q.bathrooms !== undefined && q.bathrooms !== '') where.bathrooms = { gte: this.nonNegative(q.bathrooms, 'Bathrooms') };
    if (q.furnished) where.furnishedStatus = q.furnished;
    const include = { propertyType: true, images: { orderBy: { sortOrder: 'asc' as const }, take: 1 }, owner: { select: { id: true, firstName: true, lastName: true, avatar: true } }, _count: { select: { savedBy: true, viewingRequests: true } } };
    let rows = await this.prisma.propertyListing.findMany({ where, include, orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit });
    const lat = Number(q.latitude), lng = Number(q.longitude), distance = Number(q.distance);
    const mapped = rows.map(row => ({ ...row, distanceKm: Number.isFinite(lat) && Number.isFinite(lng) && row.latitude && row.longitude ? this.distance(lat, lng, Number(row.latitude), Number(row.longitude)) : null }));
    const items = Number.isFinite(distance) && distance > 0 ? mapped.filter(item => item.distanceKm !== null && item.distanceKm <= distance) : mapped;
    const total = await this.prisma.propertyListing.count({ where });
    return { items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async detail(idOrSlug: string) {
    await this.expire();
    const listing = await this.prisma.propertyListing.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], listingStatus: { in: PUBLIC } }, include: { propertyType: true, images: { orderBy: { sortOrder: 'asc' } }, owner: { select: { id: true, firstName: true, lastName: true, avatar: true, phone: true, isVerified: true, _count: { select: { propertyListings: true } } } }, _count: { select: { savedBy: true, viewingRequests: true } } } });
    if (!listing) throw new NotFoundException('Property listing not found');
    await this.prisma.propertyListing.update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } });
    return { ...listing, latitude: listing.showExactLocation ? listing.latitude : listing.latitude ? Number(listing.latitude).toFixed(3) : null, longitude: listing.showExactLocation ? listing.longitude : listing.longitude ? Number(listing.longitude).toFixed(3) : null, contactEmail: null, contactPhone: null };
  }

  async create(userId: string, body: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isActive) throw new ForbiddenException('An active account is required');
    const data = await this.input(body, true);
    const slug = await this.uniqueSlug(data.title);
    return this.prisma.propertyListing.create({ data: { ...data, slug, ownerId: userId, images: { create: this.images(body.imageUrls) } }, include: { propertyType: true, images: true } });
  }

  async update(userId: string, id: string, body: any) {
    const current = await this.owned(userId, id);
    if (([PropertyListingStatus.SOLD, PropertyListingStatus.RENTED, PropertyListingStatus.SUSPENDED] as PropertyListingStatus[]).includes(current.listingStatus)) throw new BadRequestException('This listing cannot be edited in its current status');
    const data = await this.input(body, false);
    const imageData = body.imageUrls ? { deleteMany: {}, create: this.images(body.imageUrls) } : undefined;
    return this.prisma.propertyListing.update({ where: { id }, data: { ...data, ...(imageData ? { images: imageData } : {}) }, include: { propertyType: true, images: { orderBy: { sortOrder: 'asc' } } } });
  }

  async publish(userId: string, id: string, body: any) {
    const listing = await this.owned(userId, id);
    const photos = await this.prisma.propertyImage.count({ where: { propertyListingId: id } });
    if (!photos) throw new BadRequestException('Add at least one property photo before publishing');
    const days = [7, 15, 30].includes(Number(body.durationDays)) ? Number(body.durationDays) : 30;
    const moderation = process.env.PROPERTY_REQUIRE_APPROVAL === 'true';
    return this.prisma.propertyListing.update({ where: { id }, data: { listingStatus: moderation ? 'PENDING' : 'ACTIVE', publishedAt: new Date(), expiresAt: new Date(Date.now() + days * 86400000), moderationReason: null } });
  }

  async mine(userId: string, q: any) { await this.expire(); return this.prisma.propertyListing.findMany({ where: { ownerId: userId, ...(q.status ? { listingStatus: q.status } : {}) }, include: { propertyType: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 }, _count: { select: { savedBy: true, viewingRequests: true } } }, orderBy: { updatedAt: 'desc' } }); }
  async ownerStatus(userId: string, id: string, status: string) { const listing = await this.owned(userId, id); const allowed = ['ACTIVE', 'INACTIVE', 'RESERVED', 'SOLD', 'RENTED']; if (!allowed.includes(status)) throw new BadRequestException('Unsupported listing status'); if (listing.listingStatus === 'SUSPENDED') throw new ForbiddenException('A suspended listing can only be restored by an administrator'); return this.prisma.propertyListing.update({ where: { id }, data: { listingStatus: status as PropertyListingStatus } }); }
  async remove(userId: string, id: string) { const listing = await this.owned(userId, id); if (!['DRAFT', 'INACTIVE', 'EXPIRED', 'REJECTED'].includes(listing.listingStatus)) throw new BadRequestException('Deactivate the listing before deleting it'); await this.prisma.propertyListing.delete({ where: { id } }); return { deleted: true }; }

  async save(userId: string, id: string) { await this.publicListing(id); return this.prisma.savedProperty.upsert({ where: { userId_propertyListingId: { userId, propertyListingId: id } }, create: { userId, propertyListingId: id }, update: {} }); }
  async unsave(userId: string, id: string) { await this.prisma.savedProperty.deleteMany({ where: { userId, propertyListingId: id } }); return { saved: false }; }
  async saved(userId: string) { return this.prisma.savedProperty.findMany({ where: { userId, listing: { listingStatus: { in: PUBLIC } } }, include: { listing: { include: { propertyType: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } }, orderBy: { createdAt: 'desc' } }); }

  async requestViewing(userId: string, id: string, body: any) { const listing = await this.publicListing(id); if (listing.ownerId === userId) throw new BadRequestException('You cannot request a viewing for your own listing'); const date = new Date(body.preferredDate); if (Number.isNaN(date.getTime()) || date < new Date(new Date().toDateString())) throw new BadRequestException('Choose a valid future date'); if (!body.preferredTime || !body.name?.trim() || !body.contactNumber?.trim()) throw new BadRequestException('Date, time, name and contact number are required'); return this.prisma.propertyViewingRequest.create({ data: { propertyListingId: id, requesterId: userId, preferredDate: date, preferredTime: String(body.preferredTime).slice(0, 30), name: body.name.trim().slice(0, 120), contactNumber: body.contactNumber.trim().slice(0, 30), message: body.message?.trim().slice(0, 2000) || null } }); }
  async receivedViewings(userId: string) { return this.prisma.propertyViewingRequest.findMany({ where: { listing: { ownerId: userId } }, include: { listing: { select: { id: true, title: true, slug: true } }, requester: { select: { id: true, firstName: true, lastName: true, avatar: true } } }, orderBy: { createdAt: 'desc' } }); }
  async viewingStatus(userId: string, id: string, status: string) { if (!Object.values(PropertyViewingStatus).includes(status as any)) throw new BadRequestException('Unsupported viewing status'); const viewing = await this.prisma.propertyViewingRequest.findUnique({ where: { id }, include: { listing: true } }); if (!viewing) throw new NotFoundException('Viewing request not found'); if (viewing.listing.ownerId !== userId) throw new ForbiddenException('Only the property seller can update this request'); return this.prisma.propertyViewingRequest.update({ where: { id }, data: { status: status as PropertyViewingStatus } }); }
  async report(userId: string, id: string, body: any) { await this.publicListing(id); if (!REPORT_REASONS.includes(body.reason)) throw new BadRequestException('Select a valid report reason'); return this.prisma.propertyReport.upsert({ where: { reporterId_propertyListingId: { reporterId: userId, propertyListingId: id } }, create: { reporterId: userId, propertyListingId: id, reason: body.reason, details: body.details?.trim().slice(0, 2000) || null }, update: { reason: body.reason, details: body.details?.trim().slice(0, 2000) || null, status: 'OPEN' } }); }

  async adminList(q: any) { const page = Math.max(1, Number(q.page) || 1), limit = Math.min(100, Math.max(1, Number(q.limit) || 25)); const where: any = {}; if (q.status && q.status !== 'ALL') where.listingStatus = q.status; if (q.search) where.OR = [{ title: { contains: q.search, mode: 'insensitive' } }, { city: { contains: q.search, mode: 'insensitive' } }, { owner: { OR: [{ firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] } }]; const [items, total] = await Promise.all([this.prisma.propertyListing.findMany({ where, include: { propertyType: true, images: { take: 1, orderBy: { sortOrder: 'asc' } }, owner: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } }, _count: { select: { reports: { where: { status: 'OPEN' } }, savedBy: true, viewingRequests: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), this.prisma.propertyListing.count({ where })]); return { items, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }; }
  async moderate(id: string, body: any) { const listing = await this.prisma.propertyListing.findUnique({ where: { id } }); if (!listing) throw new NotFoundException('Property listing not found'); const action = String(body.action); if (action === 'SUSPEND') { if (!body.reason?.trim()) throw new BadRequestException('A suspension reason is required'); return this.prisma.propertyListing.update({ where: { id }, data: { statusBeforeSuspend: listing.listingStatus, listingStatus: 'SUSPENDED', moderationReason: body.reason.trim() } }); } if (action === 'RESTORE') return this.prisma.propertyListing.update({ where: { id }, data: { listingStatus: listing.statusBeforeSuspend || 'INACTIVE', statusBeforeSuspend: null, moderationReason: null } }); if (action === 'APPROVE') return this.prisma.propertyListing.update({ where: { id }, data: { listingStatus: 'ACTIVE', moderationReason: null, publishedAt: listing.publishedAt || new Date() } }); if (action === 'REJECT') return this.prisma.propertyListing.update({ where: { id }, data: { listingStatus: 'REJECTED', moderationReason: body.reason?.trim() || 'Listing did not meet the property policy.' } }); if (action === 'VERIFY') return this.prisma.propertyListing.update({ where: { id }, data: { isVerified: Boolean(body.value ?? true) } }); if (action === 'FEATURE') return this.prisma.propertyListing.update({ where: { id }, data: { isFeatured: Boolean(body.value ?? true), featuredUntil: body.until ? new Date(body.until) : null } }); throw new BadRequestException('Unsupported moderation action'); }
  async createType(body: any) { if (!body.name?.trim() || !body.groupName?.trim()) throw new BadRequestException('Name and group are required'); const slug = this.slug(body.slug || body.name); return this.prisma.propertyType.create({ data: { name: body.name.trim(), slug, groupName: body.groupName.trim(), displayOrder: Number(body.displayOrder) || 0 } }); }
  async updateType(id: string, body: any) { return this.prisma.propertyType.update({ where: { id }, data: { ...(body.name ? { name: body.name.trim() } : {}), ...(body.groupName ? { groupName: body.groupName.trim() } : {}), ...(body.displayOrder !== undefined ? { displayOrder: Number(body.displayOrder) || 0 } : {}), ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}) } }); }

  private async input(body: any, required: boolean) { const data: any = {}; const set = (key: string, value: any) => { if (value !== undefined) data[key] = value; }; if (required || body.title !== undefined) { if (!body.title?.trim() || body.title.trim().length < 5) throw new BadRequestException('Title must be at least 5 characters'); set('title', body.title.trim().slice(0, 180)); } if (required || body.description !== undefined) { if (!body.description?.trim() || body.description.trim().length < 20) throw new BadRequestException('Description must be at least 20 characters'); set('description', body.description.trim().slice(0, 10000)); } if (required || body.transactionType !== undefined) { if (!Object.values(PropertyTransactionType).includes(body.transactionType)) throw new BadRequestException('Choose For Sale or For Rent'); set('transactionType', body.transactionType); set('pricePeriod', body.transactionType === 'FOR_RENT' ? (Object.values(PropertyPricePeriod).includes(body.pricePeriod) ? body.pricePeriod : 'MONTHLY') : 'NONE'); } if (required || body.propertyTypeId !== undefined) { const type = await this.prisma.propertyType.findFirst({ where: { id: body.propertyTypeId, isActive: true } }); if (!type) throw new BadRequestException('Choose a valid property type'); set('propertyTypeId', type.id); } if (required || body.price !== undefined) set('price', this.nonNegative(body.price, 'Price')); for (const key of ['bedrooms', 'parkingSpaces']) if (body[key] !== undefined && body[key] !== '') set(key, Math.floor(this.nonNegative(body[key], key))); for (const key of ['bathrooms', 'floorArea', 'lotArea']) if (body[key] !== undefined && body[key] !== '') set(key, this.nonNegative(body[key], key)); for (const key of ['furnishedStatus', 'addressLine', 'barangay', 'postalCode', 'contactName', 'contactPhone', 'contactEmail', 'agencyName', 'prcLicenseNumber']) if (body[key] !== undefined) set(key, body[key]?.trim().slice(0, key === 'addressLine' ? 500 : 180) || null); for (const key of ['city', 'province']) if (required || body[key] !== undefined) { if (!body[key]?.trim()) throw new BadRequestException(`${key} is required`); set(key, body[key].trim().slice(0, 120)); } if (body.latitude !== undefined && body.latitude !== '') { const value = Number(body.latitude); if (!Number.isFinite(value) || value < -90 || value > 90) throw new BadRequestException('Invalid latitude'); set('latitude', value); } if (body.longitude !== undefined && body.longitude !== '') { const value = Number(body.longitude); if (!Number.isFinite(value) || value < -180 || value > 180) throw new BadRequestException('Invalid longitude'); set('longitude', value); } if (body.showExactLocation !== undefined) set('showExactLocation', Boolean(body.showExactLocation)); if (body.sellerType !== undefined) { if (!Object.values(PropertySellerType).includes(body.sellerType)) throw new BadRequestException('Choose a valid seller type'); set('sellerType', body.sellerType); } if (body.availableFrom) set('availableFrom', new Date(body.availableFrom)); return data; }
  private images(input: any) { if (!Array.isArray(input)) return []; const max = Math.min(20, Math.max(1, Number(process.env.PROPERTY_MAX_PHOTOS) || 20)); return input.filter((url: any) => typeof url === 'string' && /^(https?:\/\/|\/)/.test(url)).slice(0, max).map((imageUrl: string, sortOrder: number) => ({ imageUrl, sortOrder, isPrimary: sortOrder === 0 })); }
  private nonNegative(value: any, label: string) { const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`${label} must be zero or greater`); return number; }
  private async owned(userId: string, id: string) { const listing = await this.prisma.propertyListing.findUnique({ where: { id } }); if (!listing) throw new NotFoundException('Property listing not found'); if (listing.ownerId !== userId) throw new ForbiddenException('This property listing belongs to another user'); return listing; }
  private async publicListing(id: string) { const listing = await this.prisma.propertyListing.findFirst({ where: { id, listingStatus: { in: PUBLIC } } }); if (!listing) throw new NotFoundException('Property listing not found'); return listing; }
  private async expire() { await this.prisma.propertyListing.updateMany({ where: { listingStatus: 'ACTIVE', expiresAt: { lte: new Date() } }, data: { listingStatus: 'EXPIRED' } }); }
  private slug(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'property'; }
  private async uniqueSlug(title: string) { const base = this.slug(title); let slug = `${base}-${Date.now().toString(36)}`; while (await this.prisma.propertyListing.findUnique({ where: { slug } })) slug = `${base}-${Math.random().toString(36).slice(2, 8)}`; return slug; }
  private distance(aLat: number, aLng: number, bLat: number, bLng: number) { const r = 6371, dLat = (bLat-aLat)*Math.PI/180, dLng = (bLng-aLng)*Math.PI/180; const x = Math.sin(dLat/2)**2 + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLng/2)**2; return Math.round(r*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x))*10)/10; }
}
