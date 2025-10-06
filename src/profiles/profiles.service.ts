import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    // retorna o profile "flat" (ou objeto vazio se não existir)
    const p = await this.prisma.profile.findUnique({
      where: { userId },
    });
    return p ?? {};
  }

  async upsertMe(userId: string, dto: UpdateProfileDto) {
    // normaliza cep só números (opcional)
    const cep = dto.cep ? dto.cep.replace(/\D/g, '').slice(0, 8) : undefined;

    // upsert do profile
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {
        phone: dto.phone ?? undefined,
        cep,
        address: dto.address ?? undefined,
        city: dto.city ?? undefined,
        profession: dto.profession ?? undefined,
        incomeRange: dto.incomeRange ?? undefined,
        maritalStatus: dto.maritalStatus ?? undefined,
      },
      create: {
        userId,
        phone: dto.phone ?? undefined,
        cep,
        address: dto.address ?? undefined,
        city: dto.city ?? undefined,
        profession: dto.profession ?? undefined,
        incomeRange: dto.incomeRange ?? undefined,
        maritalStatus: dto.maritalStatus ?? undefined,
      },
    });

    // opcional: atualizar o nome no próprio User
    if (dto.name && dto.name.trim().length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name.trim() },
      });
    }

    return profile;
  }

  async upsertByUserId(userId: string, dto: UpdateProfileDto) {
    const data = {
      address: (dto.address),
      city: (dto.city),
      profession: (dto.profession),
      phone: (dto.phone),
    };

    return this.prisma.profile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  // (opcionais para admins, caso queira)
  async getByUserId(adminUserId: string, targetUserId: string) {
    // aqui você poderia validar roles antes (no controller com guard)
    return this.prisma.profile.findUnique({ where: { id: targetUserId } });
  }

  async getUserWithProfile(targetUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        profile: true,
        // inclua o que mais fizer sentido:
        // sponsorships: { select: { id: true, status: true, campaignId: true, createdAt: true } },
      },
    });

    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }
}
