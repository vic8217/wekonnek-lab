import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Address, Prisma } from "@prisma/client";

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUser(userId: string): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  }

  async create(data: Prisma.AddressUncheckedCreateInput): Promise<Address> {
    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId: data.userId },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.create({ data });
  }

  async update(
    userId: string,
    id: string,
    data: Prisma.AddressUpdateInput,
  ): Promise<Address> {
    if (data.isDefault) {
      const existing = await this.prisma.address.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("Address not found");
      if (existing.userId !== userId)
        throw new ForbiddenException("This address belongs to another user");
      if (existing) {
        await this.prisma.address.updateMany({
          where: { userId: existing.userId },
          data: { isDefault: false },
        });
      }
    }
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Address not found");
    if (existing.userId !== userId)
      throw new ForbiddenException("This address belongs to another user");
    const address = await this.prisma.address.update({ where: { id }, data });
    if (!address) throw new NotFoundException("Address not found");
    return address;
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Address not found");
    if (existing.userId !== userId)
      throw new ForbiddenException("This address belongs to another user");
    await this.prisma.address.delete({ where: { id } });
  }
}
