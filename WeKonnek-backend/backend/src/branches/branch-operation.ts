export function scheduledOpen(operatingHours: unknown, now = new Date()) {
  if (!operatingHours || typeof operatingHours !== 'object' || Array.isArray(operatingHours)) return false;
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = local.getUTCDay();
  const hours = operatingHours as Record<string, any>;
  const period = day === 0
    ? hours.sunday
    : day === 6
      ? hours.saturday
      : hours['monday-friday'] || hours.weekday || hours.monday;
  if (!period || period.closed === true || !period.open || !period.close) return false;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const toMinutes = (value: string) => {
    const [hour, minute] = String(value).split(':').map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : NaN;
  };
  const open = toMinutes(period.open), close = toMinutes(period.close);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return false;
  return close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
}

export function operationState(branch: any) {
  const scheduleIsOpen = scheduledOpen(branch.operatingHours);
  return {
    is_open: Boolean(branch.isActive) && (branch.manualOpenOverride ?? scheduleIsOpen),
    schedule_is_open: scheduleIsOpen,
    operation_source: branch.manualOpenOverride === null ? 'schedule' : 'manual',
    manual_open_override: branch.manualOpenOverride,
    manual_override_updated_at: branch.manualOverrideUpdatedAt,
  };
}
