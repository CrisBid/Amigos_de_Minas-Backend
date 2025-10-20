// src/modules/exports/export-sponsorships.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportLevel, ExportSponsorshipsQueryDto } from './dto/export-sponsorships.dto';
import { buildExcelBuffer, ChildRow } from './utils/excel.util';
// Opcional: se quiser tipar os filtros com os enums:
import { SponsorshipStatus, SponsorshipMethod } from '@prisma/client';

function calcAge(birth: Date | null): number | null {
  if (!birth) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

@Injectable()
export class ExportSponsorshipsService {
  constructor(private prisma: PrismaService) {}

  async fetchRows(query: ExportSponsorshipsQueryDto): Promise<ChildRow[]> {
    const statusList = query.status
      ? query.status.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const methodList = query.method
      ? query.method.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    // Where base
    const where: any = {};

    if (statusList?.length) where.status = { in: statusList as SponsorshipStatus[] };
    if (methodList?.length) where.method = { in: methodList as SponsorshipMethod[] };

    // Níveis/filtros — agora direto da CRIANÇA (cityId/communityId)
    switch (query.level) {
      case ExportLevel.CITY:
        if (query.cityId) where.child = { cityId: query.cityId };
        break;
      case ExportLevel.COMMUNITY:
        if (query.communityId) where.child = { communityId: query.communityId };
        break;
      case ExportLevel.SPONSOR:
        if (query.sponsorId) where.sponsorId = query.sponsorId;
        break;
      case ExportLevel.SELECTION:
        if (query.ids) {
          const ids = query.ids.split(',').map(s => s.trim()).filter(Boolean);
          if (ids.length) where.id = { in: ids };
        }
        break;
      case ExportLevel.GENERAL:
      default:
        // sem filtro adicional
        break;
    }

    const sponsorships = await this.prisma.sponsorship.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        status: true,
        method: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        pixTxid: true,
        donationAmount: true,

        // Pega só o necessário do padrinho (evita dados sensíveis)
        sponsor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            profile: { select: { phone: true } },
            // nunca inclua passwordHash
          },
        },

        // Cidade/comunidade direto da criança
        child: {
          select: {
            id: true,
            publicId: true,
            name: true,
            birthDate: true,
            age: true, // se você preenche isso no banco; se não, será null e caímos no calcAge
            wantedGift: true, // no seu schema é wantedGift; ajuste se seu DTO usa outro nome
            motherName: true,
            cityName: true, // texto legado, útil como fallback
            city: { select: { id: true, publicId: true, name: true } },
            community: { select: { id: true, publicId: true, name: true } },
            school: { select: { id: true, publicId: true, name: true } }, // opcional
          },
        },

        collectionPoint: {
          select: { id: true, name: true, cityName: true, state: true },
        },
      },
    });

    // Mapeia linhas
    const rows: ChildRow[] = sponsorships.map(sp => {
      const child = sp.child;
      const birthDate: Date | null = child?.birthDate ?? null;
      const age = child?.age ?? calcAge(birthDate);

      // Contato do padrinho: priorize profile.phone -> sponsor.phone -> email
      const contact =
        child?.id && sp.sponsor?.profile?.phone
          ? sp.sponsor.profile.phone
          : sp.sponsor?.phone || sp.sponsor?.email || null;

      // PIX: no schema há pixTxid (não pixKey)
      const pix = sp.pixTxid ?? null;

      // Cidade/comunidade/escola direto da criança
      const cityName = child?.city?.name ?? child?.cityName ?? null;
      const communityName = child?.community?.name ?? null;
      const schoolName = child?.school?.name ?? null;

      return {
        publicId: child?.publicId ?? null,
        childName: child?.name ?? null,
        birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        age,
        gift: child?.wantedGift ?? null,
        mother: child?.motherName ?? null,

        sponsorName: sp.sponsor?.name ?? null,
        contact,
        method: sp.method ?? null,
        pix,
        collectionPoint: sp.collectionPoint?.name ?? null,

        city: cityName,
        community: communityName,
        school: schoolName,

        // chaves de agrupamento (com fallbacks legíveis)
        _cityKey: cityName || 'Sem cidade',
        _communityKey: communityName || 'Sem comunidade',
        _schoolKey: schoolName || 'Sem escola',
        _sponsorKey: sp.sponsor?.name || 'Sem padrinho',
      } as ChildRow;
    });

    return rows;
  }

  async generateExcel(query: ExportSponsorshipsQueryDto) {
    const rows = await this.fetchRows(query);

    // Decide a estratégia de abas com base no level
    const levelForExcel: 'general' | 'city' | 'community' | 'sponsor' | 'selection' =
      (query.level as any) || 'general';

    const buffer = await buildExcelBuffer(rows, levelForExcel);
    return buffer;
  }
}
