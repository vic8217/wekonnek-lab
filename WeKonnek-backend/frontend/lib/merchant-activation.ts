export type MerchantActivationPayload = {
  is_active: boolean;
};

export function merchantReactivationPayload(): MerchantActivationPayload {
  return { is_active: true };
}

export function merchantDeactivationPayload(): MerchantActivationPayload {
  return { is_active: false };
}

export function merchantIsActive(merchant: {
  is_active?: boolean;
  isActive?: boolean;
  status?: string;
}) {
  if (merchant.is_active !== undefined) return merchant.is_active;
  if (merchant.isActive !== undefined) return merchant.isActive;
  return merchant.status === 'active';
}

export function merchantDisplayStatus(merchant: {
  is_active?: boolean;
  isActive?: boolean;
  status?: string;
}) {
  if (merchantIsActive(merchant)) return 'active';
  if (merchant.status === 'suspended' || merchant.status === 'deactivated') {
    return merchant.status;
  }
  return 'inactive';
}
