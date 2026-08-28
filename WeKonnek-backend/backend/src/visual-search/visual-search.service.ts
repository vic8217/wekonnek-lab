import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { operationState } from '../branches/branch-operation';
import { VISUAL_SEARCH_LIMITS, type VisualSearchScope } from './visual-search.constants';
import { VISUAL_SEARCH_PROVIDER, type VisualSearchProvider } from './visual-search.provider';

type SearchInput = { image: Buffer; scope: VisualSearchScope; latitude?: number; longitude?: number; radiusKm?: number; city?: string };
const distanceKm = (a: number, b: number, c: number, d: number) => { const r = Math.PI / 180; const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };

@Injectable()
export class VisualSearchService {
  constructor(private readonly prisma: PrismaService, @Inject(VISUAL_SEARCH_PROVIDER) private readonly provider: VisualSearchProvider) {}
  async search(input: SearchInput) {
    if (input.scope === 'NEARBY' && (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || !VISUAL_SEARCH_LIMITS.allowedRadiusKm.includes(input.radiusKm as 3 | 5 | 10 | 20))) throw new BadRequestException('Nearby search requires a supported radius and location');
    if (input.scope === 'CITY' && !input.city?.trim()) throw new BadRequestException('City search requires a city');
    const embedding = await this.provider.createQueryEmbedding(input.image);
    const candidates = await this.provider.searchSimilarProducts(embedding, { limit: VISUAL_SEARCH_LIMITS.initialCandidates });
    return this.resolveCandidates(candidates, input);
  }
  private async resolveCandidates(candidates: Awaited<ReturnType<VisualSearchProvider['searchSimilarProducts']>>, input: SearchInput) {
    if (!candidates.length) return [];
    const score = new Map(candidates.map(item => [item.productId, item.score]));
    const rows = await this.prisma.shopProduct.findMany({ where: { productId: { in: candidates.map(item => item.productId) }, isEnabled: true, isOnMenu: true, menuVisible: true, shop: { isActive: true, merchant: { isActive: true, status: 'active' } }, product: { availabilityStatus: 'Available' } }, include: { shop: true, product: true, merchant: true } });
    const inventory = await this.prisma.shopInventory.findMany({ where: { OR: rows.map(row => ({ shopId: row.shopId, productId: row.productId })) } });
    const available = new Map<string, number>(); inventory.forEach(item => { const key = `${item.shopId}:${item.productId}`; available.set(key, (available.get(key) || 0) + item.quantity - item.reservedQuantity); });
    return rows.filter(row => {
      if (input.scope === 'CITY' && row.shop.city?.trim().toLowerCase() !== input.city?.trim().toLowerCase()) return false;
      if (input.scope === 'NEARBY') { if (row.shop.latitude == null || row.shop.longitude == null) return false; if (distanceKm(input.latitude!, input.longitude!, Number(row.shop.latitude), Number(row.shop.longitude)) > input.radiusKm!) return false; }
      return !row.product.trackInventory || (available.get(`${row.shopId}:${row.productId}`) || 0) > 0;
    }).slice(0, VISUAL_SEARCH_LIMITS.finalResults).map(row => ({ productId: row.productId, productName: row.product.name, imageUrl: row.product.imageUrl, price: row.priceOverride || row.product.discountPrice || row.product.sellingPrice || row.product.price, merchantId: row.merchantId, merchantName: row.merchant.name, branchId: row.shopId, branchName: row.shop.name, city: row.shop.city, latitude: row.shop.latitude, longitude: row.shop.longitude, distanceKm: input.scope === 'NEARBY' ? distanceKm(input.latitude!, input.longitude!, Number(row.shop.latitude), Number(row.shop.longitude)) : undefined, availabilityStatus: 'AVAILABLE', branchOpenStatus: operationState(row.shop).is_open ? 'OPEN' : 'CLOSED', visualScore: score.get(row.productId) || 0 })).sort((a, b) => b.visualScore - a.visualScore || (a.distanceKm || 0) - (b.distanceKm || 0));
  }
}
