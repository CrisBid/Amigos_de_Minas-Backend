import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChildrenExportQueryDto, BindFilter, ExportLevel } from './dto/query.dto';
import { buildChildrenExcel, ChildRow } from './utils/excel.util';

function calcAge(birth: Date | null): number | null {
  if (!birth) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// considere estes status como "apadrinhamento ativo" — ajuste conforme sua regra:
const ACTIVE_SPONSORSHIP = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;

@Injectable()
export class ChildrenExportService {
  constructor(private prisma: PrismaService) {}

  async fetchRows(q: ChildrenExportQueryDto): Promise<ChildRow[]> {
    // WHERE base por localização (agora direto da CRIANÇA)
    const whereChild: any = {};

    if (q.level === ExportLevel.CITY && q.cityId) {
      whereChild.cityId = q.cityId;
    }
    if (q.level === ExportLevel.COMMUNITY && q.communityId) {
      whereChild.communityId = q.communityId;
    }
    if (q.level === ExportLevel.SELECTION && q.ids) {
      const ids = q.ids.split(/[\s,;\n\r]+/).map(s => s.trim()).filter(Boolean);
      if (ids.length) whereChild.id = { in: ids };
    }

    // filtro por vinculação
    if (q.bind === BindFilter.SPONSORED) {
      whereChild.sponsorships = { some: { status: { in: ACTIVE_SPONSORSHIP as any } } };
    } else if (q.bind === BindFilter.UNSPONSORED) {
      whereChild.sponsorships = { none: { status: { in: ACTIVE_SPONSORSHIP as any } } };
    }

    const children = await this.prisma.child.findMany({
      where: whereChild,
      orderBy: [{ publicId: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        publicId: true,
        name: true,
        birthDate: true,
        age: true,            // se você mantém isso; caso não, fica null e usamos calcAge
        motherName: true,
        wantedGift: true,
        // textos legados úteis como fallback
        cityName: true,

        city: { select: { id: true, publicId: true, name: true } },
        community: { select: { id: true, publicId: true, name: true } },
        // escola é opcional: mantenha se quiser exibir na planilha
        school: { select: { id: true, publicId: true, name: true } },

        sponsorships: {
          where: { status: { in: ACTIVE_SPONSORSHIP as any } },
          orderBy: { createdAt: 'desc' },
          take: 1, // vínculo ativo mais recente (se houver)
          select: {
            method: true,
            pixTxid: true,
            collectionPoint: { select: { name: true } },
            sponsor: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                profile: { select: { phone: true } },
              },
            },
          },
        },
      },
    });

    // mapeia para linhas
    const rows: ChildRow[] = children.map(ch => {
      const birthDate = ch.birthDate ? new Date(ch.birthDate) : null;
      const age = ch.age ?? calcAge(birthDate);

      const cityName = ch.city?.name ?? ch.cityName ?? null;
      const communityName = ch.community?.name ?? null;
      const schoolName = ch.school?.name ?? null;

      const active = ch.sponsorships?.[0] || null;
      const hasSponsor = !!active;

      const sponsorName = active?.sponsor?.name ?? null;
      // prioriza profile.phone -> sponsor.phone -> email
      const sponsorContact =
        active?.sponsor?.profile?.phone ??
        active?.sponsor?.phone ??
        active?.sponsor?.email ??
        null;

      const method = active?.method ?? null;
      const pix = active?.pixTxid ?? null;
      const collectionPoint = active?.collectionPoint?.name ?? null;
      const gift = ch.wantedGift ?? null;

      return {
        publicId: ch.publicId ?? null,
        childName: ch.name ?? '',
        birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        age,
        mother: ch.motherName ?? null,

        hasSponsor,
        sponsorName,
        sponsorContact,
        method,
        pix,
        collectionPoint,
        gift,

        city: cityName,
        community: communityName,
        school: schoolName,

        _cityKey: cityName || 'Sem cidade',
        _communityKey: communityName || 'Sem comunidade',
        _schoolKey: schoolName || 'Sem escola',
      };
    });

    return rows;
  }

  async generateExcel(q: ChildrenExportQueryDto) {
    const rows = await this.fetchRows(q);
    const buffer = await buildChildrenExcel(rows, (q.level as any) || 'general');
    return buffer;
  }
}
