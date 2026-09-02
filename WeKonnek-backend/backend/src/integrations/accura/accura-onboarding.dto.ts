import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ACCURA_TAX_CLASSIFICATIONS } from './accura-onboarding.types';

export class UpdateAccuraOnboardingProfileDto {
  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  tradeName?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  contactEmail?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  contactPhone?: string | null;

  @IsOptional()
  @IsString()
  registeredAddressLine1?: string;

  @IsOptional()
  @IsString()
  tin?: string;

  @IsOptional()
  @IsIn([...ACCURA_TAX_CLASSIFICATIONS])
  classification?: (typeof ACCURA_TAX_CLASSIFICATIONS)[number];
}

export class CreateAccuraOnboardingBranchDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;
}

export class UpdateAccuraOnboardingBranchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MapAccuraShopBranchDto {
  @Type(() => Number)
  @IsInt()
  shopId!: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  accuraBranchId?: string | null;
}
