// src/modules/exports/export-sponsorships.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportLevel, ExportSponsorshipsQueryDto } from './dto/export-sponsorships.dto';
import { buildCustomExcel, DEFAULT_FIELDS, EXPORT_FIELDS, ExportRow, GroupBy, SPONSOR_FIELDS, sponsorContacts } from './utils/custom-export.util';
// Opcional: se quiser tipar os filtros com os enums:
import { SponsorshipStatus, SponsorshipMethod } from '@prisma/client';
import { applyCampaignData, applySponsorshipCampaignData, campaignDataSelect } from '../../common/child-campaign-data';
import { Prisma } from '@prisma/client';

function calcAge(birth: Date | null): number | null {
  if (!birth) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function parseEnumList<T extends string>(
  csv: string | undefined,
  valid: readonly T[],
): T[] | undefined {
  if (!csv) return undefined;
  const set = new Set(valid.map(v => v.toUpperCase()));
  const out = csv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toUpperCase())
    .filter(s => set.has(s)) as T[];
  return out.length ? out : undefined;
}

const STATUS_PT: Record<SponsorshipStatus, string> = {
  PENDING: 'Pendente',
  IN_PROGRESS: 'Em andamento',
  IN_PURCHASE: 'Em compra',
  PACKED: 'Embalado',
  BOXED: 'Encaixotado',
  AWAITING_DELIVERY: 'Aguardando entrega',
  COMPLETED: 'Concluído',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
};

@Injectable()
export class ExportSponsorshipsService {
  constructor(private prisma: PrismaService) {}

  async fetchRows(query: ExportSponsorshipsQueryDto): Promise<ExportRow[]> {
    const statusList = parseEnumList(query.status, Object.values(SponsorshipStatus));
    const methodList = parseEnumList(query.method, Object.values(SponsorshipMethod));

    const where: any = {};
    if (statusList) where.status = { in: statusList };
    if (methodList) where.method = { in: methodList };
    if (query.campaignId) where.campaignId = query.campaignId;

    // recorte: cidade/comunidade direto da criança, padrinho ou lista de apadrinhamentos
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
          const ids = query.ids.split(',').map((s) => s.trim()).filter(Boolean);
          if (ids.length) where.id = { in: ids };
        }
        break;
      default:
        break;
    }

    const sponsorships = await this.prisma.sponsorship.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        campaignId: true,
        status: true,
        method: true,
        createdAt: true,
        donationAmount: true,
        // só o necessário do padrinho (nunca a senha)
        sponsor: { select: { id: true, name: true, email: true, phone: true, profile: { select: { phone: true } } } },
        child: {
          select: {
            id: true,
            publicId: true,
            name: true,
            birthDate: true,
            age: true,
            wantedGift: true,
            motherName: true,
            cityName: true,
            city: { select: { name: true } },
            community: { select: { name: true } },
            school: { select: { name: true } },
            campaignData: campaignDataSelect, // ID e presente desta campanha
          },
        },
        collectionPoint: { select: { name: true, cityName: true } },
      },
    });

    const rows = sponsorships.map(applySponsorshipCampaignData).map((sp): ExportRow => {
      const child = sp.child;
      const birthDate: Date | null = child?.birthDate ?? null;
      return {
        sponsorshipId: sp.id,
        childId: child?.id ?? null,
        publicId: child?.publicId ?? null,
        childName: child?.name ?? '',
        birthDate: birthDate ? birthDate.toISOString().slice(0, 10) : null,
        age: calcAge(birthDate) ?? child?.age ?? null,
        gift: child?.wantedGift ?? null,
        mother: child?.motherName ?? null,
        city: child?.city?.name ?? child?.cityName ?? null,
        community: child?.community?.name ?? null,
        school: child?.school?.name ?? null,
        sponsorId: sp.sponsor?.id ?? null,
        sponsorName: sp.sponsor?.name ?? null,
        sponsorEmail: sp.sponsor?.email ?? null,
        sponsorPhone: sp.sponsor?.profile?.phone || sp.sponsor?.phone || null,
        method: sp.method ?? null,
        donationAmount: sp.donationAmount != null ? Number(sp.donationAmount) : null,
        status: sp.status ?? null,
        statusLabel: sp.status ? STATUS_PT[sp.status] : null,
        collectionPoint: sp.collectionPoint?.name
          ? `${sp.collectionPoint.name}${sp.collectionPoint.cityName ? ` (${sp.collectionPoint.cityName})` : ''}`
          : null,
        createdAt: sp.createdAt ? sp.createdAt.toISOString() : null,
      };
    });
    if (query.includeUnsponsored === '1') rows.push(...(await this.unsponsoredRows(query)));
    return rows;
  }

  /**
   * Crianças da campanha no recorte (todas, a cidade ou a comunidade) sem apadrinhamento —
   * cancelado conta como sem padrinho. Não se aplica ao recorte por padrinho ou por lista de IDs.
   */
  private async unsponsoredRows(query: ExportSponsorshipsQueryDto): Promise<ExportRow[]> {
    const campaignId = query.campaignId;
    if (!campaignId) return [];
    const where: Prisma.ChildWhereInput = {
      deletedAt: null,
      OR: [{ images: { some: { campaignId } } }, { campaignIncludes: { some: { campaignId } } }],
      sponsorships: { none: { campaignId, status: { not: SponsorshipStatus.CANCELLED } } },
    };
    switch (query.level) {
      case ExportLevel.CITY:
        if (!query.cityId) return [];
        where.cityId = query.cityId;
        break;
      case ExportLevel.COMMUNITY:
        if (!query.communityId) return [];
        where.communityId = query.communityId;
        break;
      case ExportLevel.SPONSOR:
      case ExportLevel.SELECTION:
        return [];
      default:
        break;
    }
    const children = await this.prisma.child.findMany({
      where,
      select: {
        id: true, publicId: true, name: true, birthDate: true, age: true, wantedGift: true, motherName: true, cityName: true,
        city: { select: { name: true } },
        community: { select: { name: true } },
        school: { select: { name: true } },
        campaignData: campaignDataSelect,
      },
    });
    return children.map((c) => {
      applyCampaignData(c, campaignId);
      return {
        sponsorshipId: `free:${c.id}`,
        childId: c.id,
        unsponsored: true,
        publicId: c.publicId ?? null,
        childName: c.name ?? '',
        birthDate: c.birthDate ? c.birthDate.toISOString().slice(0, 10) : null,
        age: calcAge(c.birthDate) ?? c.age ?? null,
        gift: c.wantedGift ?? null,
        mother: c.motherName ?? null,
        city: c.city?.name ?? c.cityName ?? null,
        community: c.community?.name ?? null,
        school: c.school?.name ?? null,
        sponsorId: null, sponsorName: null, sponsorEmail: null, sponsorPhone: null,
        method: null, donationAmount: null,
        status: null, statusLabel: 'Sem padrinho',
        collectionPoint: null,
        createdAt: null,
      };
    });
  }

  /** Colunas pedidas (na ordem pedida); sem nenhuma válida, as padrão */
  private fields(query: ExportSponsorshipsQueryDto) {
    const valid = new Set(EXPORT_FIELDS.map((f) => f.key));
    const list = (query.fields ?? '').split(',').map((s) => s.trim()).filter((k) => valid.has(k));
    return list.length ? [...new Set(list)] : DEFAULT_FIELDS;
  }

  private groupBy(query: ExportSponsorshipsQueryDto): GroupBy {
    const ok: GroupBy[] = ['community', 'city', 'school', 'sponsor', 'collectionPoint', 'none'];
    return ok.includes(query.groupBy as GroupBy) ? (query.groupBy as GroupBy) : 'community';
  }

  /** Linhas em JSON (prévia e PDF da tela), com a lista de padrinhos */
  async rows(query: ExportSponsorshipsQueryDto) {
    const rows = await this.fetchRows(query);
    return { rows, sponsors: sponsorContacts(rows), fields: this.fields(query), available: EXPORT_FIELDS };
  }

  async generateExcel(query: ExportSponsorshipsQueryDto) {
    const rows = await this.fetchRows(query);
    return buildCustomExcel({
      rows,
      fields: this.fields(query),
      groupBy: this.groupBy(query),
      layout: query.layout === 'single' ? 'single' : 'tabs',
      sponsorList: query.sponsorList !== '0',
      giftSummary: query.giftSummary !== '0',
      pointsSummary: query.pointsSummary === '1',
      sponsorFields: (query.sponsorFields ?? '').split(',').map((s) => s.trim()).filter((k) => SPONSOR_FIELDS.some((f) => f.key === k)),
      sortBy: query.sortBy === 'id' || query.sortBy === 'sponsor' ? query.sortBy : 'name',
    });
  }
}
