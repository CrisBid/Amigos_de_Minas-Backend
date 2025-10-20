// src/modules/exports/export-sponsorships.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportLevel, ExportSponsorshipsQueryDto } from './dto/export-sponsorships.dto';
import { buildExcelBuffer, ChildRow } from './utils/excel.util';

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

    if (statusList?.length) where.status = { in: statusList as any[] };
    if (methodList?.length) where.method = { in: methodList as any[] };

    // Níveis/filtros
    switch (query.level) {
      case ExportLevel.CITY:
        if (query.cityId) where.child = { school: { community: { cityId: query.cityId } } };
        break;
      case ExportLevel.COMMUNITY:
        if (query.communityId) where.child = { school: { communityId: query.communityId } };
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
      include: {
        sponsor: true,
        child: {
          include: {
            school: {
              include: {
                community: {
                  include: { city: true },
                },
              },
            },
          },
        },
        collectionPoint: true, // se existir na sua modelagem
      },
    });

    // Mapeia linhas
    const rows: ChildRow[] = sponsorships.map(sp => {
      const child = sp.child;
      const school = child?.school || null;
      const community = school?.community || null;
      const city = community?.city || null;

      const birthDate = child?.birthDate ? new Date(child.birthDate) : null;
      const age = calcAge(birthDate);

      // Contato do padrinho (prioriza celular, depois email, ajuste conforme seu schema)
      const contact =
        (sp.sponsor as any)?.phone ||
        (sp.sponsor as any)?.mobile ||
        (sp.sponsor as any)?.email ||
        null;

      // PIX: pode vir de sponsorship.pixKey, sponsor.pixKey, etc. Ajuste conforme seu schema
      const pix =
        (sp as any).pixKey ||
        (sp.sponsor as any)?.pixKey ||
        null;

      return {
        publicId: child?.publicId ?? null,
        childName: child?.name ?? null,
        birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        age,
        gift: (sp as any)?.gift || (child as any)?.gift || null,
        mother: (child as any)?.mother || null,

        sponsorName: sp.sponsor?.name ?? null,
        contact,
        method: sp.method ?? null,
        pix,
        collectionPoint: sp.collectionPoint?.name ?? null,

        city: city?.name ?? null,
        community: community?.name ?? null,
        school: school?.name ?? null,

        _cityKey: city?.name || 'Sem cidade',
        _communityKey: community?.name || 'Sem comunidade',
        _schoolKey: school?.name || 'Sem escola',
        _sponsorKey: sp.sponsor?.name || 'Sem padrinho',
      };
    });

    return rows;
  }

  async generateExcel(query: ExportSponsorshipsQueryDto) {
    const rows = await this.fetchRows(query);

    // Decide a estratégia de abas com base no level
    let levelForExcel: 'general' | 'city' | 'community' | 'sponsor' | 'selection' =
      (query.level as any) || 'general';

    const buffer = await buildExcelBuffer(rows, levelForExcel);
    return buffer;
  }
}
