// src/modules/exports/export-sponsorships.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportLevel, ExportSponsorshipsQueryDto } from './dto/export-sponsorships.dto';
import { buildCustomExcel, DEFAULT_FIELDS, EXPORT_FIELDS, ExportRow, GroupBy, sponsorContacts } from './utils/custom-export.util';
// Opcional: se quiser tipar os filtros com os enums:
import { SponsorshipStatus, SponsorshipMethod } from '@prisma/client';
import { applySponsorshipCampaignData, campaignDataSelect } from '../../common/child-campaign-data';

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

    return sponsorships.map(applySponsorshipCampaignData).map((sp): ExportRow => {
      const child = sp.child;
      const birthDate: Date | null = child?.birthDate ?? null;
      return {
        sponsorshipId: sp.id,
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
      sortBy: query.sortBy === 'id' ? 'id' : 'name',
    });
  }
}
