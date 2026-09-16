/**
 * Stage 7 migration SQL acceptance against wekonnek_stage7_test.
 * Controlled raw-SQL apply (repository historical baseline may lack full
 * from-zero migrate deploy). Does NOT fabricate _prisma_migrations rows.
 *
 * Proves: structural rollback, residual enum labels, reapply with existing
 * labels, and residual-label non-authority for public custody recording.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const STAGE7_ENV = resolve(__dirname, '../../.env.stage7.test');
const STAGE7_ENV_PRESENT = existsSync(STAGE7_ENV);

if (STAGE7_ENV_PRESENT) {
  loadEnv({ path: STAGE7_ENV, override: true });
}

import { ForbiddenException } from '@nestjs/common';
import {
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CustodyEventService } from '../agreements/custody-event.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';

const describeIf = STAGE7_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATION_DIR = resolve(
  __dirname,
  '../../prisma/migrations/20260916220000_stage7_secure_rider_custody_handoff',
);
const MIGRATION_SQL = resolve(MIGRATION_DIR, 'migration.sql');
const ROLLBACK_SQL = resolve(MIGRATION_DIR, 'rollback.sql');

describeIf('Stage 7 migration SQL proof (wekonnek_stage7_test)', () => {
  const prisma = new PrismaService();
  const events = new OrderDomainEventService(prisma);
  const custody = new CustodyEventService(prisma, events);

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(target[0]?.database).toBe('wekonnek_stage7_test');
    expect(['victor', 'wekonnek_stage7_test']).toContain(target[0]?.user);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  function applySqlFile(path: string) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL required');
    execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', path], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  }

  async function assertStage7SchemaPresent() {
    const table = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.rider_custody_handoff_tokens')::text AS exists
    `;
    expect(table[0]?.exists).toBe('rider_custody_handoff_tokens');

    const fulfillmentCols = await prisma.$queryRaw<
      Array<{ column_name: string }>
    >`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_fulfillments'
        AND column_name IN (
          'physical_custodian_rider_id',
          'pending_custody_incoming_rider_id',
          'pending_custody_from_assignment_version',
          'pending_custody_requested_at'
        )
      ORDER BY column_name
    `;
    expect(fulfillmentCols.map((c) => c.column_name)).toEqual([
      'pending_custody_from_assignment_version',
      'pending_custody_incoming_rider_id',
      'pending_custody_requested_at',
      'physical_custodian_rider_id',
    ]);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'rider_custody_handoff_tokens'
      ORDER BY indexname
    `;
    const names = indexes.map((i) => i.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'rider_custody_handoff_tokens_pkey',
        'rider_custody_handoff_tokens_token_hash_key',
        'rider_custody_handoff_tokens_otp_hash_key',
        'rider_custody_handoff_tokens_release_custody_event_id_key',
        'rider_custody_handoff_tokens_receipt_custody_event_id_key',
        'rider_custody_handoff_tokens_confirm_idempotency_key_key',
        'rider_custody_handoff_tokens_active_fulfillment_purpose_key',
        'rider_custody_handoff_tokens_fulfillment_id_status_idx',
        'rider_custody_handoff_tokens_wk_order_id_status_idx',
        'rider_custody_handoff_tokens_outgoing_rider_id_status_idx',
        'rider_custody_handoff_tokens_incoming_rider_id_status_idx',
        'rider_custody_handoff_tokens_status_expires_at_idx',
        'rider_custody_handoff_tokens_source_assignment_idx',
      ]),
    );

    const partial = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'rider_custody_handoff_tokens_active_fulfillment_purpose_key'
    `;
    expect(partial[0]?.indexdef).toMatch(/WHERE.*status.*=.*'ACTIVE'/i);

    const fks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.rider_custody_handoff_tokens'::regclass
        AND contype = 'f'
      ORDER BY conname
    `;
    expect(fks.map((f) => f.conname)).toEqual(
      expect.arrayContaining([
        'rider_custody_handoff_tokens_wk_order_id_fkey',
        'rider_custody_handoff_tokens_fulfillment_id_fkey',
        'rider_custody_handoff_tokens_outgoing_rider_id_fkey',
        'rider_custody_handoff_tokens_incoming_rider_id_fkey',
        'rider_custody_handoff_tokens_source_rider_assignment_id_fkey',
        'rider_custody_handoff_tokens_release_custody_event_id_fkey',
        'rider_custody_handoff_tokens_receipt_custody_event_id_fkey',
      ]),
    );

    const check = await prisma.$queryRaw<Array<{ conname: string; def: string }>>`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.rider_custody_handoff_tokens'::regclass
        AND contype = 'c'
    `;
    expect(check.map((c) => c.conname)).toContain(
      'rider_custody_handoff_tokens_otp_attempts_check',
    );
    expect(
      check.find(
        (c) => c.conname === 'rider_custody_handoff_tokens_otp_attempts_check',
      )?.def,
    ).toMatch(/otp_failed_attempts.*0.*5|BETWEEN 0 AND 5/i);

    const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type
      WHERE typname IN (
        'RiderCustodyHandoffPurpose',
        'RiderCustodyHandoffTokenStatus'
      )
      ORDER BY typname
    `;
    expect(enums.map((e) => e.typname)).toEqual([
      'RiderCustodyHandoffPurpose',
      'RiderCustodyHandoffTokenStatus',
    ]);
  }

  async function assertStage7SchemaAbsent() {
    const table = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.rider_custody_handoff_tokens')::text AS exists
    `;
    expect(table[0]?.exists).toBeNull();

    const fulfillmentCols = await prisma.$queryRaw<
      Array<{ column_name: string }>
    >`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_fulfillments'
        AND column_name IN (
          'physical_custodian_rider_id',
          'pending_custody_incoming_rider_id',
          'pending_custody_from_assignment_version',
          'pending_custody_requested_at'
        )
    `;
    expect(fulfillmentCols).toHaveLength(0);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE indexname LIKE 'rider_custody_handoff_tokens%'
         OR indexname = 'order_fulfillments_physical_custodian_rider_id_status_idx'
    `;
    expect(indexes).toHaveLength(0);

    const types = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type
      WHERE typname IN (
        'RiderCustodyHandoffPurpose',
        'RiderCustodyHandoffTokenStatus'
      )
    `;
    expect(types).toHaveLength(0);
  }

  async function assertResidualTransferEnumLabels() {
    const labels = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'CustodyEventType'
        AND e.enumlabel IN (
          'RIDER_TRANSFER_RELEASED',
          'RIDER_TRANSFER_RECEIVED'
        )
      ORDER BY e.enumlabel
    `;
    expect(labels.map((l) => l.enumlabel)).toEqual([
      'RIDER_TRANSFER_RECEIVED',
      'RIDER_TRANSFER_RELEASED',
    ]);
  }

  it('documents ADD VALUE IF NOT EXISTS for safe rollback/reapply', () => {
    const migrationBody = readFileSync(MIGRATION_SQL, 'utf8');
    expect(migrationBody).toMatch(/ADD VALUE IF NOT EXISTS 'RIDER_TRANSFER_RELEASED'/);
    expect(migrationBody).toMatch(/ADD VALUE IF NOT EXISTS 'RIDER_TRANSFER_RECEIVED'/);
    expect(migrationBody).toMatch(/otp_failed_attempts.*BETWEEN 0 AND 5/s);
    const rollbackBody = readFileSync(ROLLBACK_SQL, 'utf8');
    expect(rollbackBody).toMatch(/IRREVERSIBLE SCHEMA RESIDUE|residual/i);
    expect(rollbackBody).not.toMatch(/DROP TYPE.*CustodyEventType/);
  });

  it('migration.sql + rollback.sql establish and remove Stage 7 schema with residual enum labels', async () => {
    expect(existsSync(MIGRATION_SQL)).toBe(true);
    expect(existsSync(ROLLBACK_SQL)).toBe(true);

    applySqlFile(MIGRATION_SQL);
    await assertStage7SchemaPresent();

    applySqlFile(ROLLBACK_SQL);
    await assertStage7SchemaAbsent();
    await assertResidualTransferEnumLabels();

    // Reapply must succeed despite residual enum labels.
    applySqlFile(MIGRATION_SQL);
    await assertStage7SchemaPresent();
    await assertResidualTransferEnumLabels();

    // With schema restored (and residual labels still present historically),
    // generic public custody API must not treat enum labels as authority.
    const tag = randomUUID();
    const customer = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s7-roll-${tag}@test.invalid`,
        role: UserRole.customer,
      },
    });
    const rider = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s7-roll-r-${tag}@test.invalid`,
        role: UserRole.rider,
      },
    });
    const merchantUser = await prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `s7-roll-m-${tag}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S7 roll ${tag}`,
        slug: `s7-roll-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    await prisma.merchantPaymentMethod.create({
      data: {
        id: randomUUID(),
        merchantId: merchant.id,
        kind: MerchantPaymentMethodKind.CASH,
        displayName: 'Cash',
        enabled: true,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S7R-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 1000,
        deliveryFee: 50,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
      },
    });
    const fulfillment = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.in_transit,
        assignmentVersion: 1,
        activeRiderId: rider.id,
        physicalCustodianRiderId: rider.id,
      },
    });

    await expect(
      custody.record({
        actorUserId: rider.id,
        eventType: CustodyEventType.RIDER_TRANSFER_RELEASED,
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        fromPartyRole: 'RIDER',
        toPartyRole: 'RIDER',
        fromUserId: rider.id,
        toUserId: rider.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      custody.record({
        actorUserId: rider.id,
        eventType: CustodyEventType.RIDER_TRANSFER_RECEIVED,
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        fromPartyRole: 'RIDER',
        toPartyRole: 'RIDER',
        fromUserId: rider.id,
        toUserId: rider.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Second rollback + reapply cycle (labels already present).
    applySqlFile(ROLLBACK_SQL);
    await assertStage7SchemaAbsent();
    await assertResidualTransferEnumLabels();
    applySqlFile(MIGRATION_SQL);
    await assertStage7SchemaPresent();

    await prisma.orderFulfillment.delete({ where: { id: fulfillment.id } }).catch(() => undefined);
    await prisma.wkOrder.delete({ where: { id: order.id } }).catch(() => undefined);
    await prisma.merchantPaymentMethod.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.merchant.delete({ where: { id: merchant.id } }).catch(() => undefined);
    await prisma.user.deleteMany({
      where: { id: { in: [customer.id, rider.id, merchantUser.id] } },
    });
  });
});
