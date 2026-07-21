import { PartialType } from '@nestjs/mapped-types';
import { CreateStaffPostDto } from './create-staff-post.dto';

export class UpdateStaffPostDto extends PartialType(CreateStaffPostDto) {}
