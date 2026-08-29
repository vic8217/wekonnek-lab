import { Prisma } from '@prisma/client';
import { moneyDecimal, moneyNumber } from '../modules/wallet/wallet-money';

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Asia/Manila calendar day. The Philippines does not observe DST, so UTC+8 matches Asia/Manila. */
export function philippineBillingDay(now = new Date()) {
  const local = new Date(now.getTime() + MANILA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const periodStart = new Date(Date.UTC(year, month, day) - MANILA_OFFSET_MS);
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
  const key = `${year}${String(month + 1).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  return { key, periodStart, periodEnd, timeZone: 'Asia/Manila' as const };
}

export function dailySubscriptionReference(
  merchantId: number,
  billingKey = philippineBillingDay().key,
) {
  return `SUB-${merchantId}-${billingKey}`;
}

export function addOnQuantity(quantities: unknown, id: string) {
  if (
    !quantities ||
    typeof quantities !== 'object' ||
    Array.isArray(quantities)
  )
    return 1;
  const value = Number((quantities as Record<string, unknown>)[id]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function computeDailySubscriptionFee(
  planFee: number,
  addOns: Array<{ id: string; amount: unknown }>,
  quantities: unknown,
) {
  const addOnFee = addOns.reduce(
    (sum, addOn) =>
      sum.plus(moneyDecimal(addOn.amount).times(addOnQuantity(quantities, addOn.id))),
    new Prisma.Decimal(0),
  );
  const dailySubscriptionFee = moneyDecimal(planFee).plus(addOnFee);
  return {
    planFee: moneyNumber(planFee),
    addOnFee: moneyNumber(addOnFee),
    dailySubscriptionFee: moneyNumber(dailySubscriptionFee),
  };
}

export const DEFAULT_SUBSCRIPTION_BILLING_CRON = '5 0 * * *';
export const DEFAULT_SUBSCRIPTION_BILLING_CATCHUP_CRON = '5 * * * *';
export const DEFAULT_SUBSCRIPTION_BILLING_TZ = 'Asia/Manila';

export function subscriptionBillingSchedule(
  env: {
    get?: (key: string) => string | undefined;
  } = {},
) {
  const read = (key: string, fallback: string) => {
    const value = env.get?.(key);
    return value === undefined || value === '' ? fallback : value;
  };
  return {
    cron: read(
      'SUBSCRIPTION_DAILY_BILLING_CRON',
      DEFAULT_SUBSCRIPTION_BILLING_CRON,
    ),
    catchupCron: read(
      'SUBSCRIPTION_DAILY_BILLING_CATCHUP_CRON',
      DEFAULT_SUBSCRIPTION_BILLING_CATCHUP_CRON,
    ),
    timeZone: read(
      'SUBSCRIPTION_DAILY_BILLING_TZ',
      DEFAULT_SUBSCRIPTION_BILLING_TZ,
    ),
  };
}
