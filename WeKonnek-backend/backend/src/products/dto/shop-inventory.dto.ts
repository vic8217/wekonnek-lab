import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AssignShopProductDto {
  @IsBoolean() isEnabled: boolean;
  @IsOptional() @IsNumber() @Min(0) priceOverride?: number | null;
}

export const INVENTORY_MOVEMENT_TYPES = ['receipt', 'sale', 'return', 'adjustment'] as const;

export class CreateInventoryMovementDto {
  @IsInt() productId: number;
  @IsOptional() @IsInt() variantId?: number | null;
  @IsIn(INVENTORY_MOVEMENT_TYPES) type: string;
  @IsInt() quantity: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsNumber() @Min(0) unitCost?: number;
  @IsOptional() @IsString() referenceType?: string;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() deliveryDate?: string;
  @IsOptional() @IsString() deliveredBy?: string;
  @IsOptional() @IsString() receivedAt?: string;
}

export class UpdateReorderLevelDto {
  @IsInt() productId: number;
  @IsOptional() @IsInt() variantId?: number | null;
  @IsInt() @Min(0) reorderLevel: number;
}

export class TransferInventoryDto {
  @IsInt() destinationShopId: number;
  @IsInt() productId: number;
  @IsOptional() @IsInt() variantId?: number | null;
  @IsInt() @Min(1) quantity: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CloseInventoryDayDto {
  @IsInt() productId: number;
  @IsOptional() @IsInt() variantId?: number | null;
  @IsString() businessDate: string;
  @IsInt() @Min(0) endingBalance: number;
  @IsOptional() @IsString() notes?: string;
}
