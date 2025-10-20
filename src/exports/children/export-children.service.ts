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
    // WHERE base por localização
    const whereChild: any = {};

    if (q.level === ExportLevel.CITY && q.cityId) {
      whereChild.school = { community: { cityId: q.cityId } };
    }
    if (q.level === ExportLevel.COMMUNITY && q.communityId) {
      whereChild.school = { communityId: q.communityId };
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
      include: {
        school: { include: { community: { include: { city: true } } } },
        sponsorships: {
          where: { status: { in: ACTIVE_SPONSORSHIP as any } },
          orderBy: { createdAt: 'desc' },
          take: 1, // pega o vínculo ativo mais recente (se houver)
          include: {
            sponsor: {
              select: { id: true, name: true, email: true, phone: true, profile: { select: { phone: true } } },
            },
            collectionPoint: true,
          },
        },
      },
    });

    // mapeia para linhas
    const rows: ChildRow[] = children.map(ch => {
      const birthDate = ch.birthDate ? new Date(ch.birthDate) : null;
      const age = calcAge(birthDate);

      const school = ch.school;
      const community = school?.community;
      const city = community?.city;

      const active = ch.sponsorships?.[0] || null;
      const hasSponsor = !!active;

      const sponsorName = active?.sponsor?.name ?? null;
      const sponsorContact =
        active?.sponsor?.phone ?? active?.sponsor?.profile?.phone ?? active?.sponsor?.email ?? null;

      const method = (active as any)?.method ?? null;
      const pix = (active as any)?.pixKey ?? (active as any)?.sponsor?.pixKey ?? null;
      const collectionPoint = active?.collectionPoint?.name ?? null;
      const gift = (active as any)?.gift ?? (ch as any)?.gift ?? null;

      return {
        publicId: ch.publicId ?? null,
        childName: ch.name ?? '',
        birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        age,
        mother: (ch as any)?.mother ?? null,

        hasSponsor,
        sponsorName,
        sponsorContact,
        method,
        pix,
        collectionPoint,
        gift,

        city: city?.name ?? null,
        community: community?.name ?? null,
        school: school?.name ?? null,

        _cityKey: city?.name || 'Sem cidade',
        _communityKey: community?.name || 'Sem comunidade',
        _schoolKey: school?.name || 'Sem escola',
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
