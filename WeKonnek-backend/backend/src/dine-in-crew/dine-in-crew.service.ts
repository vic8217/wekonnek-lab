import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { DineInSyncService } from './dine-in-sync.service';
import { JwtService } from '@nestjs/jwt';

export const DINE_IN_CREW_FEATURE = 'DINE_IN_CREW';
const ROLES = ['WAITER', 'SERVER', 'CASHIER', 'SUPERVISOR', 'MANAGER'];
const DEVICE_ROLES = ['PRIMARY_COUNTER', 'CREW_HANDHELD'];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class DineInCrewService {
  private readonly entitlementCache = new Map<number, { expiresAt: number; enabled: boolean }>();
  constructor(private readonly prisma: PrismaService, private readonly sync: DineInSyncService, private readonly jwt: JwtService) {}

  private async ownedMerchant(userId: string, merchantId?: number) {
    const merchant = await this.prisma.merchant.findFirst({
      where: merchantId ? { id: merchantId, userId } : { userId },
      include: { branches: { where: { isActive: true }, orderBy: { isDefault: 'desc' } } },
    });
    if (!merchant) throw new ForbiddenException('Merchant administrator access is required');
    return merchant;
  }

  async entitlement(merchantId: number, throwOnFailure = false) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const now = new Date();
    const active = merchant.subscriptionStatus.toLowerCase() === 'active' &&
      (!merchant.subscriptionExpiresAt || merchant.subscriptionExpiresAt > now || merchant.subscriptionPlan.toLowerCase() === 'daily');
    const [plan, grant] = await Promise.all([
      this.prisma.subscriptionPlanDefinition.findUnique({ where: { audience_tier: { audience: 'merchant', tier: merchant.subscriptionTier.toLowerCase() } } }),
      this.prisma.merchantFeatureGrant.findFirst({ where: { merchantId, featureKey: DINE_IN_CREW_FEATURE, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    ]);
    const planFeature = plan?.isActive && plan.features.some(feature => feature.trim().toUpperCase() === DINE_IN_CREW_FEATURE);
    const enabled = active && Boolean(planFeature || grant);
    const result = { featureKey: DINE_IN_CREW_FEATURE, activeSubscription: active, enabled, source: grant ? grant.source : planFeature ? 'plan' : null, limits: (grant?.limits as any) || {} };
    if (throwOnFailure && !active) throw new ForbiddenException({ code: 'FEATURE_NOT_AVAILABLE', message: 'Your merchant subscription is inactive. Renew your subscription to use Crew & Device Management.' });
    if (throwOnFailure && !enabled) throw new ForbiddenException({ code: 'FEATURE_NOT_AVAILABLE', message: 'Crew & Device Management is not included in your current plan.', upgradeUrl: '/merchant/subscription/upgrade' });
    return result;
  }

  private async cachedOperationalEntitlement(merchantId: number) {
    const cached = this.entitlementCache.get(merchantId);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.enabled) throw new ForbiddenException({ code: 'FEATURE_NOT_AVAILABLE', message: 'Crew & Device Management is not currently available.' });
      return;
    }
    const result = await this.entitlement(merchantId, true);
    this.entitlementCache.set(merchantId, { enabled: result.enabled, expiresAt: Date.now() + 120_000 });
  }

  private async requireOwner(userId: string, merchantId?: number) {
    const merchant = await this.ownedMerchant(userId, merchantId);
    const entitlement = await this.entitlement(merchant.id, true);
    return { merchant, entitlement };
  }

  async overview(userId: string, branchId?: number) {
    const merchant = await this.ownedMerchant(userId);
    if (branchId && !merchant.branches.some(branch => branch.id === branchId)) {
      throw new ForbiddenException('This shop does not belong to the merchant');
    }
    const entitlement = await this.entitlement(merchant.id);
    const [staff, devices] = await Promise.all([
      this.prisma.merchantStaff.findMany({ where: { merchantId: merchant.id, ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}) }, include: { user: { select: { firstName: true, lastName: true, email: true, phone: true, avatar: true } }, branch: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.crewDevice.findMany({ where: { merchantId: merchant.id, ...(branchId ? { shopId: branchId } : {}) }, include: { shop: { select: { name: true } } }, orderBy: { registeredAt: 'desc' } }),
    ]);
    const visibleBranches = branchId ? merchant.branches.filter(branch => branch.id === branchId) : merchant.branches;
    return { merchant: { id: merchant.id, name: merchant.name }, shops: visibleBranches.map(b => ({ id: b.id, name: b.name })), currentShop: visibleBranches[0] ? { id: visibleBranches[0].id, name: visibleBranches[0].name } : null, entitlement, staff: staff.map(s => ({ id: s.id, firstName: s.user.firstName, lastName: s.user.lastName, displayName: s.displayName, role: s.dineInRole, employeeCode: s.employeeCode, isActive: s.isActive, hasPin: Boolean(s.crewPinHash), branch: s.branch })), devices: devices.map(({ tokenHash, ...d }) => d) };
  }

  async createCrew(userId: string, input: any) {
    const { merchant, entitlement } = await this.requireOwner(userId);
    const role = String(input.role || '').toUpperCase();
    if (!ROLES.includes(role)) throw new BadRequestException('Select a valid dine-in crew role');
    if (!/^\d{4,6}$/.test(String(input.pin || ''))) throw new BadRequestException('Crew PIN must contain 4–6 digits');
    const limits = entitlement.limits as any; const max = Number(limits.maxCrewUsers || 0);
    if (max && await this.prisma.merchantStaff.count({ where: { merchantId: merchant.id, dineInRole: { not: null }, isActive: true } }) >= max) throw new ForbiddenException({ code: 'CREW_LIMIT_REACHED', message: `Your entitlement allows ${max} active crew users.` });
    const firstName = String(input.firstName || '').trim(), lastName = String(input.lastName || '').trim();
    if (!firstName || !lastName) throw new BadRequestException('First and last name are required');
    const email = String(input.email || '').trim() || null; const phone = String(input.phone || '').trim() || `crew:${merchant.id}:${randomUUID()}`;
    const record = await this.prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { firstName, lastName, email, phone, role: 'staff', isActive: true, status: 'active' } });
      return tx.merchantStaff.create({ data: { merchantId: merchant.id, userId: user.id, branchId: input.shopId ? Number(input.shopId) : null, role: ['MANAGER','SUPERVISOR'].includes(role) ? 'manager' : role === 'CASHIER' ? 'cashier' : 'staff', displayName: String(input.displayName || `${firstName} ${lastName.charAt(0)}.`).trim(), dineInRole: role, employeeCode: String(input.employeeCode || '').trim() || null, crewPinHash: await bcrypt.hash(String(input.pin), 12) }, include: { user: true, branch: true } });
    });
    await this.audit(merchant.id, record.branchId, record.id, null, 'CREW_CREATED', { role });
    return { id: record.id, displayName: record.displayName, role: record.dineInRole, isActive: record.isActive };
  }

  async updateCrew(userId: string, id: number, input: any) {
    const { merchant } = await this.requireOwner(userId);
    const staff = await this.prisma.merchantStaff.findFirst({ where: { id, merchantId: merchant.id } });
    if (!staff) throw new NotFoundException('Crew member not found');
    const data: any = {};
    if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
    if (input.role) { const role = String(input.role).toUpperCase(); if (!ROLES.includes(role)) throw new BadRequestException('Invalid role'); data.dineInRole = role; }
    if (input.displayName !== undefined) data.displayName = String(input.displayName).trim();
    if (input.pin !== undefined) { if (!/^\d{4,6}$/.test(String(input.pin))) throw new BadRequestException('Crew PIN must contain 4–6 digits'); data.crewPinHash = await bcrypt.hash(String(input.pin), 12); }
    const updated = await this.prisma.merchantStaff.update({ where: { id }, data });
    await this.audit(merchant.id, updated.branchId, id, null, updated.isActive ? 'CREW_ACTIVATED' : 'CREW_DEACTIVATED', {});
    return { id, displayName: updated.displayName, role: updated.dineInRole, isActive: updated.isActive, hasPin: Boolean(updated.crewPinHash) };
  }

  async createPairing(userId: string, input: any) {
    const { merchant, entitlement } = await this.requireOwner(userId);
    const shopId = Number(input.shopId); const shop = merchant.branches.find(b => b.id === shopId);
    if (!shop) throw new BadRequestException('Select a valid shop');
    const role = String(input.role || 'CREW_HANDHELD').toUpperCase(); if (!DEVICE_ROLES.includes(role)) throw new BadRequestException('Invalid device role');
    if (role === 'PRIMARY_COUNTER' && await this.prisma.crewDevice.count({ where: { shopId, role, status: 'active' } })) throw new BadRequestException('This shop already has an active Primary Counter');
    const max = Number((entitlement.limits as any).maxCrewDevices || 0);
    if (max && await this.prisma.crewDevice.count({ where: { merchantId: merchant.id, role: 'CREW_HANDHELD', status: 'active' } }) >= max) throw new ForbiddenException({ code: 'DEVICE_LIMIT_REACHED', message: `Your entitlement allows ${max} active crew devices.` });
    const code = String(Math.floor(100000 + Math.random() * 900000)); const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.prisma.crewPairingToken.create({ data: { merchantId: merchant.id, shopId, role, codeHash: digest(code), expiresAt, createdByUserId: userId } });
    const appUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const pairingUrl = `${appUrl}/crew/pair?code=${encodeURIComponent(code)}`;
    const qrCode = await QRCode.toDataURL(pairingUrl, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
    return { code, expiresAt, role, shop: shop.name, pairingUrl, qrCode };
  }

  async pairDevice(input: any) {
    const codeHash = digest(String(input.code || '')); const pairing = await this.prisma.crewPairingToken.findUnique({ where: { codeHash }, include: { merchant: true, shop: true } });
    if (!pairing || pairing.usedAt || pairing.expiresAt <= new Date()) throw new BadRequestException('Pairing code is invalid or expired');
    await this.entitlement(pairing.merchantId, true);
    const rawToken = randomBytes(32).toString('base64url');
    const device = await this.prisma.$transaction(async tx => {
      await tx.crewPairingToken.update({ where: { id: pairing.id }, data: { usedAt: new Date() } });
      return tx.crewDevice.create({ data: { merchantId: pairing.merchantId, shopId: pairing.shopId, name: String(input.name || '').trim() || 'Crew Device', role: pairing.role, platform: String(input.platform || '').slice(0,80) || null, tokenHash: digest(rawToken), registeredByUserId: pairing.createdByUserId } });
    });
    await this.audit(device.merchantId, device.shopId, null, device.id, 'DEVICE_REGISTERED', { role: device.role });
    return { deviceToken: rawToken, device: { id: device.id, name: device.name, role: device.role, shop: pairing.shop.name, merchant: pairing.merchant.name } };
  }

  private async authorizedDevice(rawToken?: string) {
    if (!rawToken) throw new ForbiddenException('Authorized device token is required');
    const device = await this.prisma.crewDevice.findUnique({ where: { tokenHash: digest(rawToken) } });
    if (!device || device.status !== 'active') throw new ForbiddenException({ code: 'DEVICE_NOT_AUTHORIZED', message: 'This device is not authorized.' });
    await this.entitlement(device.merchantId, true);
    await this.prisma.crewDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } }); return device;
  }

  async deviceCrew(rawToken?: string) { const d = await this.authorizedDevice(rawToken); const staff = await this.prisma.merchantStaff.findMany({ where: { merchantId: d.merchantId, OR: [{ branchId: d.shopId }, { branchId: null }], isActive: true, dineInRole: { not: null }, crewPinHash: { not: null } }, include: { user: { select: { firstName: true, lastName: true, avatar: true } } } }); return staff.map(s => ({ id: s.id, displayName: s.displayName || `${s.user.firstName} ${s.user.lastName}`, role: s.dineInRole, avatar: s.user.avatar })); }

  async crewLogin(rawToken: string | undefined, input: any) { const d = await this.authorizedDevice(rawToken); const staff = await this.prisma.merchantStaff.findFirst({ where: { id: Number(input.staffId), merchantId: d.merchantId, isActive: true } }); if (!staff?.crewPinHash || !await bcrypt.compare(String(input.pin || ''), staff.crewPinHash)) throw new ForbiddenException('Invalid crew or PIN'); const raw = randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + 12 * 60 * 60_000); await this.prisma.crewDeviceSession.updateMany({ where: { deviceId: d.id, revokedAt: null }, data: { revokedAt: new Date() } }); await this.prisma.crewDeviceSession.create({ data: { deviceId: d.id, staffId: staff.id, tokenHash: digest(raw), expiresAt } }); await this.audit(d.merchantId, d.shopId, staff.id, d.id, 'CREW_DEVICE_LOGIN', {}); const operationalAccessToken=this.jwt.sign({sub:staff.userId,role:'staff',portal:'shop',merchantId:d.merchantId,branchId:d.shopId,crewStaffId:staff.id,crewDeviceId:d.id},{expiresIn:'12h'}); return { sessionToken: raw, operationalAccessToken, expiresAt, crew: { id: staff.id, displayName: staff.displayName, role: staff.dineInRole }, device: { id: d.id, name: d.name, role: d.role } }; }

  private async crewSession(rawToken?: string) {
    if (!rawToken) throw new ForbiddenException('Crew session is required');
    const session = await this.prisma.crewDeviceSession.findUnique({
      where: { tokenHash: digest(rawToken) },
      include: { device: { include: { merchant: true, shop: true } }, staff: { include: { user: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.device.status !== 'active' || !session.staff.isActive) {
      throw new ForbiddenException({ code: 'CREW_SESSION_INVALID', message: 'Crew session is expired or no longer authorized.' });
    }
    await this.cachedOperationalEntitlement(session.device.merchantId);
    return session;
  }

  async counterSnapshot(rawToken?: string) {
    const session = await this.crewSession(rawToken);
    const [tables, orders, serviceRequests] = await Promise.all([
      this.prisma.floorTable.findMany({ where: { merchantId: session.device.merchantId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.wkOrder.findMany({
        where: { shopId: session.device.shopId, orderType: { in: ['dine_in', 'in_store'] }, status: { notIn: ['completed', 'cancelled', 'delivered'] } },
        include: { orderItems: true }, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.dineInServiceRequest.findMany({ where: { shopId: session.device.shopId, assignedStaffId: session.staff.id, status: 'assigned' }, include: { order: { select: { id: true, orderCode: true, tableNumber: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const uniqueTables = tables.filter((table, index, rows) => {
      const label = table.label.trim().toLowerCase().replace(/\s+/g, ' ');
      return rows.findIndex(candidate => candidate.label.trim().toLowerCase().replace(/\s+/g, ' ') === label) === index;
    });
    return {
      shop: { id: session.device.shopId, name: session.device.shop.name, merchant: session.device.merchant.name, merchantId: session.device.merchantId },
      device: { id: session.device.id, name: session.device.name, role: session.device.role },
      crew: { id: session.staff.id, displayName: session.staff.displayName || `${session.staff.user.firstName || ''} ${session.staff.user.lastName || ''}`.trim(), role: session.staff.dineInRole },
      tables: uniqueTables,
      orders: orders.map(order => ({ id: order.id, orderCode: order.orderCode, status: order.status, tableNumber: order.tableNumber, totalAmount: order.totalAmount, notes: order.notes, createdAt: order.createdAt, paymentMethod: order.paymentMethod, discountAmount: order.discountAmount, items: order.orderItems.map(item => ({ id: item.id, productName: item.productName, quantity: item.quantity, price: item.price, subtotal: item.subtotal, status: item.status || 'preparing' })) })),
      serviceRequests: serviceRequests.map(request => ({ id: request.id, orderId: request.orderId, orderCode: request.order.orderCode, tableNumber: request.order.tableNumber, type: request.type, details: request.details, status: request.status, assignedStaffId: request.assignedStaffId, createdAt: request.createdAt })),
      synchronizedAt: new Date(),
      syncCursor: await this.sync.cursor(session.device.shopId),
    };
  }

  async crewAcceptOrder(rawToken: string | undefined, orderId: number) {
    const session = await this.crewSession(rawToken);
    const order = await this.prisma.wkOrder.findFirst({ where: { id: orderId, shopId: session.device.shopId, orderType: { in: ['dine_in', 'in_store'] } } });
    if (!order) throw new NotFoundException('Dine-in order not found');
    if (order.status !== 'pending') throw new BadRequestException('Only a newly placed order can be accepted');
    await this.prisma.wkOrder.update({ where: { id: orderId }, data: { status: 'processing' } });
    await this.audit(session.device.merchantId, session.device.shopId, session.staff.id, session.device.id, 'ORDER_ACCEPTED', { orderId });
    const cursor = await this.sync.recordOrder(orderId, 'ORDER_ACCEPTED');
    return { success: true, cursor };
  }

  async crewUpdateItem(rawToken: string | undefined, orderId: number, itemId: number, status: string) {
    const session = await this.crewSession(rawToken);
    if (!['preparing', 'served'].includes(status)) throw new BadRequestException('Item status must be preparing or served');
    const item = await this.prisma.orderItem.findFirst({ where: { id: itemId, orderId }, include: { order: true } });
    if (!item || item.order.shopId !== session.device.shopId || !['dine_in', 'in_store'].includes(item.order.orderType)) throw new NotFoundException('Dine-in item not found');
    await this.prisma.orderItem.update({ where: { id: itemId }, data: { status } });
    const remaining = await this.prisma.orderItem.count({ where: { orderId, status: { not: 'served' } } });
    await this.prisma.wkOrder.update({ where: { id: orderId }, data: { status: remaining === 0 ? 'ready' : 'preparing' } });
    await this.audit(session.device.merchantId, session.device.shopId, session.staff.id, session.device.id, status === 'served' ? 'ITEM_MARKED_SERVED' : 'ITEM_MARKED_PREPARING', { orderId, itemId });
    const cursor = await this.sync.recordOrder(orderId, status === 'served' ? 'ITEM_SERVED' : 'ITEM_PREPARING');
    return { success: true, cursor };
  }

  async crewCompleteServiceRequest(rawToken: string | undefined, requestId: number) {
    const session = await this.crewSession(rawToken);
    const request = await this.prisma.dineInServiceRequest.findFirst({ where: { id: requestId, shopId: session.device.shopId, assignedStaffId: session.staff.id, status: 'assigned' }, include: { order: true } });
    if (!request) throw new NotFoundException('Assigned service request not found');
    const updated = await this.prisma.dineInServiceRequest.update({ where: { id: requestId }, data: { status: 'completed', completedAt: new Date() }, include: { assignedStaff: true } });
    await this.audit(session.device.merchantId, session.device.shopId, session.staff.id, session.device.id, 'SERVICE_REQUEST_COMPLETED', { requestId, orderId: request.orderId });
    const serviceRequest = { id: updated.id, order_id: updated.orderId, type: updated.type, details: updated.details, status: updated.status, assigned_staff_id: updated.assignedStaffId, assigned_staff_name: updated.assignedStaff?.displayName || null, assigned_at: updated.assignedAt, completed_at: updated.completedAt, created_at: updated.createdAt };
    const cursor = await this.sync.record(request.shopId, 'SERVICE_REQUEST_UPDATED', updated.id, { serviceRequest, orderId: request.orderId });
    return { success: true, cursor, serviceRequest };
  }

  async counterChanges(rawToken: string | undefined, cursor: string) {
    const session = await this.crewSession(rawToken);
    return this.sync.changes(session.device.shopId, cursor);
  }

  async crewMenu(rawToken?: string) {
    const session = await this.crewSession(rawToken);
    const assignments = await this.prisma.shopProduct.findMany({
      where: { merchantId: session.device.merchantId, shopId: session.device.shopId, isEnabled: true, isOnMenu: true, menuVisible: true, product: { isAvailable: true } },
      include: { product: { include: { category: true, variants: { where: { isActive: true }, include: { optionValues: { include: { optionValue: true } } } } } } },
      orderBy: [{ menuCategoryOrder: 'asc' }, { menuDisplayOrder: 'asc' }, { product: { name: 'asc' } }],
    });
    const balances=await this.prisma.shopInventory.findMany({where:{merchantId:session.device.merchantId,shopId:session.device.shopId}});
    return assignments.map(a=>({productId:a.productId,name:a.product.name,imageUrl:a.product.imageUrl,category:a.menuCategory||a.product.category?.name||'Menu',hasVariants:a.product.hasVariants,price:Number(a.priceOverride??a.product.discountPrice??a.product.sellingPrice??a.product.price??0),variants:a.product.variants.map(v=>{const balance=balances.find(b=>b.productId===a.productId&&b.variantId===v.id);return{id:v.id,name:v.optionValues.map(x=>x.optionValue.value).join(' / ')||v.sku,price:Number(a.priceOverride??v.price??a.product.sellingPrice??a.product.price??0),available:a.product.trackInventory?Math.max(0,(balance?.quantity||0)-(balance?.reservedQuantity||0)):null}}),available:a.product.trackInventory?balances.filter(b=>b.productId===a.productId).reduce((n,b)=>n+Math.max(0,b.quantity-b.reservedQuantity),0):null}));
  }

  async operationalToken(rawToken?: string) {
    const session = await this.crewSession(rawToken);
    return {
      accessToken: this.jwt.sign({ sub: session.staff.userId, role: 'staff', portal: 'shop', merchantId: session.device.merchantId, branchId: session.device.shopId, crewStaffId: session.staff.id, crewDeviceId: session.device.id }, { expiresIn: '12h' }),
      merchantId: session.device.merchantId,
      shopId: session.device.shopId,
    };
  }

  async revokeDevice(userId: string, id: string) { const { merchant } = await this.requireOwner(userId); const d = await this.prisma.crewDevice.findFirst({ where: { id, merchantId: merchant.id } }); if (!d) throw new NotFoundException('Device not found'); await this.prisma.$transaction([this.prisma.crewDevice.update({ where: { id }, data: { status: 'revoked', revokedAt: new Date() } }), this.prisma.crewDeviceSession.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: new Date() } })]); await this.audit(merchant.id, d.shopId, null, id, 'DEVICE_REVOKED', {}); return { success: true }; }

  private audit(merchantId: number, shopId: number | null, staffId: number | null, deviceId: string | null, action: string, metadata: any) { return this.prisma.dineInAuditLog.create({ data: { merchantId, shopId, staffId, deviceId, action, metadata } }); }
}
