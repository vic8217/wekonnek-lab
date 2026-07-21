import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { NotificationType } from '@prisma/client';

interface CreateReservationInput {
  merchant_id?: number;
  merchantId?: number;
  reservation_date?: string;
  reservationDate?: string;
  reservation_time?: string;
  reservationTime?: string;
  number_of_guests?: number;
  numberOfGuests?: number;
  table_number?: string;
  special_requests?: string;
  contact_phone?: string;
}

function serializeReservation(r: any) {
  if (!r) return r;
  const merchant = r.merchant
    ? { ...r.merchant, is_active: r.merchant.isActive, logo_url: r.merchant.logoUrl }
    : undefined;
  return {
    id: r.id,
    reservation_code: r.reservationCode,
    reservationCode: r.reservationCode,
    user_id: r.userId,
    userId: r.userId,
    merchant_id: r.merchantId,
    merchantId: r.merchantId,
    reservation_date: r.reservationDate,
    reservationDate: r.reservationDate,
    reservation_time: r.reservationTime,
    reservationTime: r.reservationTime,
    number_of_guests: r.numberOfGuests,
    numberOfGuests: r.numberOfGuests,
    table_number: r.tableNumber,
    status: r.status,
    special_requests: r.specialRequests,
    contact_phone: r.contactPhone,
    created_at: r.createdAt,
    createdAt: r.createdAt,
    updated_at: r.updatedAt,
    merchant,
    merchants: merchant,
    customer: r.user
      ? {
          id: r.user.id,
          first_name: r.user.firstName,
          last_name: r.user.lastName,
          phone: r.user.phone,
          email: r.user.email,
        }
      : undefined,
  };
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private generateCode(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `RSV-${ts}-${rand}`;
  }

  /** Build a Time-typed value (Prisma @db.Time) from an "HH:mm" string. */
  private parseTime(time?: string): Date {
    if (!time) return new Date('1970-01-01T00:00:00Z');
    const [h, m] = time.split(':');
    return new Date(`1970-01-01T${h.padStart(2, '0')}:${(m || '00').padStart(2, '0')}:00Z`);
  }

  async create(userId: string, input: CreateReservationInput) {
    const merchantId = input.merchant_id ?? input.merchantId;
    if (!merchantId) throw new BadRequestException('merchant_id is required');

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: Number(merchantId) },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');

    const dateStr = input.reservation_date ?? input.reservationDate;
    const timeStr = input.reservation_time ?? input.reservationTime;
    const guests = input.number_of_guests ?? input.numberOfGuests ?? 1;
    if (!dateStr) throw new BadRequestException('reservation_date is required');

    const reservation = await this.prisma.reservation.create({
      data: {
        reservationCode: this.generateCode(),
        userId,
        merchantId: Number(merchantId),
        reservationDate: new Date(dateStr),
        reservationTime: this.parseTime(timeStr),
        numberOfGuests: Number(guests),
        tableNumber: input.table_number ?? null,
        status: 'pending',
        specialRequests: input.special_requests ?? null,
        contactPhone: input.contact_phone ?? null,
      },
      include: { merchant: { include: { category: true } } },
    });

    // Notify the merchant of the new booking (best-effort).
    try {
      if (merchant.userId) {
        const whenDate = new Date(dateStr).toLocaleDateString('en-PH', {
          month: 'short',
          day: 'numeric',
        });
        const whenTime = timeStr ? ` at ${timeStr}` : '';
        await this.notifications
          .notify({
            userId: merchant.userId,
            title: 'New booking received',
            body: `${reservation.reservationCode} • ${guests} guest${
              Number(guests) !== 1 ? 's' : ''
            } • ${whenDate}${whenTime}`,
            type: NotificationType.system,
            data: {
              kind: 'new_booking',
              reservationId: String(reservation.id),
              reservationCode: reservation.reservationCode,
            },
          })
          .catch(() => undefined);
      }
    } catch {
      // swallow — merchant alerts are non-critical to reservation creation
    }

    return serializeReservation(reservation);
  }

  async findAll(opts: {
    merchantId?: number;
    userId?: string;
    isAdmin?: boolean;
    status?: string;
  }) {
    const where: any = {};
    if (opts.merchantId) where.merchantId = Number(opts.merchantId);
    else if (!opts.isAdmin && opts.userId) where.userId = opts.userId;

    if (opts.status && opts.status !== 'all') {
      // status may be a comma-separated list (e.g. "pending,confirmed,checked_in")
      const statuses = opts.status.split(',').map((s) => s.trim()).filter(Boolean);
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
    }

    const reservations = await this.prisma.reservation.findMany({
      where,
      include: { merchant: { include: { category: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (opts.merchantId || opts.isAdmin) {
      const userIds = [...new Set(reservations.map((r) => r.userId))];
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, phone: true, email: true },
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      return reservations.map((r) =>
        serializeReservation({ ...r, user: byId.get(r.userId) }),
      );
    }
    return reservations.map((r) => serializeReservation(r));
  }

  async findById(id: number) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: Number(id) },
      include: { merchant: { include: { category: true } } },
    });
    if (!r) throw new NotFoundException('Reservation not found');
    return serializeReservation(r);
  }

  async updateStatus(id: number, status: string) {
    if (!status) throw new BadRequestException('status is required');
    const existing = await this.prisma.reservation.findUnique({
      where: { id: Number(id) },
    });
    if (!existing) throw new NotFoundException('Reservation not found');
    const r = await this.prisma.reservation.update({
      where: { id: Number(id) },
      data: { status },
      include: { merchant: { include: { category: true } } },
    });
    return serializeReservation(r);
  }
}
