import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SponsorshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const IN_PROGRESS: SponsorshipStatus[] = ['IN_PROGRESS', 'IN_PURCHASE', 'PACKED', 'BOXED', 'AWAITING_DELIVERY'];
const CLOSED: SponsorshipStatus[] = ['ENDED', 'CANCELLED'];
const DAY = 864e5;
/** Datas agrupadas no fuso de Brasília (sem horário de verão desde 2019) */
const localDay = (d: Date) => new Date(d.getTime() - 3 * 36e5).toISOString().slice(0, 10);

type ChildState = 'completed' | 'inProgress' | 'pending' | 'available';
type Group = {
  id: string;
  name: string;
  cityName?: string | null;
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  available: number;
  withoutPhoto: number;
};

type Activity = {
  id: string;
  kind: 'sponsorship_requested' | 'sponsorship_updated' | 'children_registered' | 'sponsor_registered';
  at: string;
  title: string;
  detail?: string | null;
  status?: SponsorshipStatus | null;
  href?: string | null;
};

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
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * Tudo que a tela /admin precisa em um único payload. Com `campaignId`: só as crianças
   * da campanha (imagens ou migradas) e só os apadrinhamentos dela; sem: o cadastro inteiro.
   */
  async overview(campaignId?: string) {
    const now = new Date();

    const campaign = campaignId
      ? await this.prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { id: true, name: true, status: true, startDate: true, endDate: true, year: true },
        })
      : null;
    if (campaignId && !campaign) throw new NotFoundException('Campanha não encontrada');

    const childWhere: Prisma.ChildWhereInput = {
      deletedAt: null,
      ...(campaignId
        ? { OR: [{ images: { some: { campaignId } } }, { campaignIncludes: { some: { campaignId } } }] }
        : {}),
    };
    const sponsorshipWhere: Prisma.SponsorshipWhereInput = campaignId ? { campaignId } : {};

    const [children, sponsorships] = await Promise.all([
      this.prisma.child.findMany({
        where: childWhere,
        select: {
          id: true,
          wantedGift: true,
          cityId: true,
          cityName: true,
          communityId: true,
          city: { select: { name: true } },
          community: { select: { name: true } },
          campaignData: campaignId ? { where: { campaignId }, select: { wantedGift: true } } : false,
          _count: { select: { images: campaignId ? { where: { campaignId } } : true } },
        },
      }),
      this.prisma.sponsorship.findMany({
        where: sponsorshipWhere,
        select: {
          id: true,
          childId: true,
          sponsorId: true,
          status: true,
          method: true,
          donationAmount: true,
          pixPaidAt: true,
          createdAt: true,
          collectionPointId: true,
          collectionPoint: { select: { name: true } },
          sponsor: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    /* ---------- situação de cada criança: vale o apadrinhamento mais recente ---------- */
    const latestByChild = new Map<string, SponsorshipStatus>();
    for (const s of sponsorships) latestByChild.set(s.childId, s.status); // ordenado por createdAt asc
    const stateOf = (childId: string): ChildState => {
      const st = latestByChild.get(childId);
      if (!st || CLOSED.includes(st)) return 'available';
      if (st === 'COMPLETED') return 'completed';
      if (st === 'PENDING') return 'pending';
      return 'inProgress';
    };

    const totals = { total: 0, completed: 0, inProgress: 0, pending: 0, available: 0, withoutPhoto: 0, withoutGift: 0 };
    const byCity = new Map<string, Group>();
    const byCommunity = new Map<string, Group>();
    const bump = (map: Map<string, Group>, key: string, init: () => Omit<Group, ChildState | 'total' | 'withoutPhoto'>, state: ChildState, noPhoto: boolean) => {
      let g = map.get(key);
      if (!g) map.set(key, (g = { ...init(), total: 0, completed: 0, inProgress: 0, pending: 0, available: 0, withoutPhoto: 0 }));
      g.total++;
      g[state]++;
      if (noPhoto) g.withoutPhoto++;
    };

    for (const c of children) {
      const state = stateOf(c.id);
      const noPhoto = c._count.images === 0;
      const gift = (campaignId ? (c as any).campaignData?.[0]?.wantedGift : null) ?? c.wantedGift;
      totals.total++;
      totals[state]++;
      if (noPhoto) totals.withoutPhoto++;
      if (!gift?.trim()) totals.withoutGift++;

      const cityName = c.city?.name ?? c.cityName ?? 'Sem cidade';
      bump(byCity, c.cityId ?? `name:${cityName}`, () => ({ id: c.cityId ?? '', name: cityName }), state, noPhoto);
      bump(
        byCommunity,
        c.communityId ?? `none:${c.cityId ?? cityName}`,
        () => ({ id: c.communityId ?? '', name: c.community?.name ?? 'Sem comunidade', cityName }),
        state,
        noPhoto,
      );
    }
    const sponsored = totals.completed + totals.inProgress;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    /* ---------- apadrinhamentos ---------- */
    const byStatus = Object.fromEntries(Object.keys(STATUS_PT).map((k) => [k, 0])) as Record<SponsorshipStatus, number>;
    const live = sponsorships.filter((s) => s.status !== 'CANCELLED');
    const methods = {
      GIFT: { count: 0 },
      PIX: { count: 0, amount: 0, paidCount: 0, paidAmount: 0 },
    };
    const sponsorCount = new Map<string, { id: string; name: string; count: number }>();
    const pointCount = new Map<string, { id: string; name: string; count: number }>();
    for (const s of sponsorships) byStatus[s.status]++;
    for (const s of live) {
      if (s.method === 'PIX') {
        const amount = s.donationAmount != null ? Number(s.donationAmount) : 0;
        methods.PIX.count++;
        methods.PIX.amount += amount;
        if (s.pixPaidAt) {
          methods.PIX.paidCount++;
          methods.PIX.paidAmount += amount;
        }
      } else {
        methods.GIFT.count++;
        if (s.collectionPointId) {
          const p = pointCount.get(s.collectionPointId) ?? { id: s.collectionPointId, name: s.collectionPoint?.name ?? '—', count: 0 };
          p.count++;
          pointCount.set(s.collectionPointId, p);
        }
      }
      const sp = sponsorCount.get(s.sponsorId) ?? { id: s.sponsorId, name: s.sponsor?.name ?? 'Padrinho', count: 0 };
      sp.count++;
      sponsorCount.set(s.sponsorId, sp);
    }

    /* ---------- pendências ---------- */
    const pendingRows = sponsorships.filter((s) => s.status === 'PENDING');
    const oldestPending = pendingRows[0]?.createdAt ?? null;
    const pendingOver3Days = pendingRows.filter((s) => now.getTime() - s.createdAt.getTime() > 3 * DAY).length;

    /* ---------- série diária: pedidos nos últimos 30 dias (ou até o fim da campanha) ---------- */
    const end = campaign?.endDate && campaign.endDate < now ? campaign.endDate : now;
    const days: { date: string; requested: number }[] = [];
    for (let i = 29; i >= 0; i--) days.push({ date: localDay(new Date(end.getTime() - i * DAY)), requested: 0 });
    const dayIndex = new Map(days.map((d, i) => [d.date, i]));
    for (const s of sponsorships) {
      const i = dayIndex.get(localDay(s.createdAt));
      if (i != null) days[i].requested++;
    }
    const sum = (from: number, to: number) => days.slice(from, to).reduce((a, d) => a + d.requested, 0);
    const last7 = sum(23, 30);
    const prev7 = sum(16, 23);

    return {
      generatedAt: now.toISOString(),
      campaign: campaign
        ? {
            ...campaign,
            daysLeft: campaign.endDate ? Math.ceil((campaign.endDate.getTime() - now.getTime()) / DAY) : null,
          }
        : null,
      children: {
        ...totals,
        sponsored,
        sponsoredRate: pct(sponsored, totals.total),
        // com pedido em andamento ou já apadrinhada (inclui pendentes)
        reservedRate: pct(sponsored + totals.pending, totals.total),
      },
      sponsorships: {
        total: live.length,
        byStatus,
        methods,
        sponsors: sponsorCount.size,
        topSponsors: [...sponsorCount.values()].sort((a, b) => b.count - a.count).slice(0, 5),
        collectionPoints: [...pointCount.values()].sort((a, b) => b.count - a.count),
      },
      pending: {
        count: pendingRows.length,
        oldestAt: oldestPending,
        over3Days: pendingOver3Days,
      },
      timeline: { days, last7, prev7 },
      byCity: [...byCity.values()].sort((a, b) => b.total - a.total),
      byCommunity: [...byCommunity.values()].sort((a, b) => b.total - a.total),
      activity: await this.activity(campaignId, childWhere),
    };
  }

  /** Últimos acontecimentos reais: pedidos, mudanças de status, cadastros (agrupados) e novos padrinhos */
  private async activity(campaignId: string | undefined, childWhere: Prisma.ChildWhereInput): Promise<Activity[]> {
    const since = new Date(Date.now() - 60 * DAY);
    const sponsorshipSelect = {
      id: true,
      status: true,
      method: true,
      createdAt: true,
      updatedAt: true,
      campaignId: true,
      child: { select: { name: true, publicId: true, campaignData: { select: { campaignId: true, publicId: true } } } },
      sponsor: { select: { name: true } },
    } satisfies Prisma.SponsorshipSelect;

    const [requested, updated, newChildren, newSponsors] = await Promise.all([
      this.prisma.sponsorship.findMany({
        where: { ...(campaignId ? { campaignId } : {}), createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: sponsorshipSelect,
      }),
      this.prisma.sponsorship.findMany({
        where: { ...(campaignId ? { campaignId } : {}), updatedAt: { gte: since }, status: { not: 'PENDING' } },
        orderBy: { updatedAt: 'desc' },
        take: 40,
        select: sponsorshipSelect,
      }),
      this.prisma.child.findMany({
        where: { ...childWhere, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { id: true, name: true, createdAt: true, cityName: true, community: { select: { name: true } } },
      }),
      this.prisma.user.findMany({
        where: { roles: { has: 'SPONSOR' }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, name: true, createdAt: true },
      }),
    ]);

    const childLabel = (s: (typeof requested)[number]) => {
      const pid = s.child.campaignData.find((d) => d.campaignId === s.campaignId)?.publicId ?? s.child.publicId;
      return `${pid} ${s.child.name}`;
    };
    const events: Activity[] = [];

    // vários pedidos do mesmo padrinho no mesmo minuto = um evento
    const reqGroups = new Map<string, (typeof requested)[number][]>();
    for (const s of requested) {
      const key = `${s.sponsor?.name ?? ''}|${Math.floor(s.createdAt.getTime() / 6e4)}`;
      reqGroups.set(key, [...(reqGroups.get(key) ?? []), s]);
    }
    for (const group of reqGroups.values()) {
      const s = group[0];
      events.push({
        id: `req-${s.id}`,
        kind: 'sponsorship_requested',
        at: s.createdAt.toISOString(),
        title:
          group.length === 1
            ? `${s.sponsor?.name ?? 'Padrinho'} pediu para apadrinhar ${childLabel(s)}`
            : `${s.sponsor?.name ?? 'Padrinho'} pediu para apadrinhar ${group.length} crianças`,
        detail: group.length > 1 ? group.map(childLabel).slice(0, 6).join(' · ') + (group.length > 6 ? '…' : '') : s.method === 'PIX' ? 'PIX' : 'Presente',
        status: group.every((g) => g.status === 'PENDING') ? 'PENDING' : null,
        href: '/admin/sponsorships',
      });
    }

    // mudança de status (só quando foi alterado depois de criado)
    for (const s of updated) {
      if (s.updatedAt.getTime() - s.createdAt.getTime() < 6e4) continue;
      events.push({
        id: `upd-${s.id}-${s.updatedAt.getTime()}`,
        kind: 'sponsorship_updated',
        at: s.updatedAt.toISOString(),
        title: `${childLabel(s)} — ${STATUS_PT[s.status].toLowerCase()}`,
        detail: s.sponsor?.name ? `Padrinho: ${s.sponsor.name}` : null,
        status: s.status,
        href: '/admin/sponsorships',
      });
    }

    // cadastros em lote viram um evento por comunidade/dia
    const childGroups = new Map<string, (typeof newChildren)[number][]>();
    for (const c of newChildren) {
      const key = `${localDay(c.createdAt)}|${c.community?.name ?? c.cityName}`;
      childGroups.set(key, [...(childGroups.get(key) ?? []), c]);
    }
    for (const group of childGroups.values()) {
      const c = group[0];
      const place = [c.community?.name, c.cityName].filter(Boolean).join(' — ');
      events.push({
        id: `child-${c.id}`,
        kind: 'children_registered',
        at: c.createdAt.toISOString(),
        title: group.length === 1 ? `Criança cadastrada: ${c.name}` : `${group.length} crianças cadastradas`,
        detail: place || null,
        href: group.length === 1 ? `/admin/children/${c.id}` : '/admin/children',
      });
    }

    for (const u of newSponsors) {
      events.push({
        id: `user-${u.id}`,
        kind: 'sponsor_registered',
        at: u.createdAt.toISOString(),
        title: `Novo padrinho cadastrado: ${u.name}`,
        href: '/admin/users',
      });
    }

    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  }
}
