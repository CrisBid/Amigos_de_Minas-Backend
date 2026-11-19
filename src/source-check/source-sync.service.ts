import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SponsorshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { ChildrenUpdateService } from '../children/children-update.service';
import { ChildImagesService } from '../child-images/child-images.service';
import { CampaignFramesService } from '../campaigns/campaign-frames.service';
import { GoogleClient } from './google.client';
import { StorageService } from '../common/storage/storage.service';

/* Resolver as pendências da conferência com a origem: cadastrar quem entrou na planilha,
   atualizar dados, corrigir ID, trazer a foto do Drive e tirar da campanha quem saiu.

   - "plan" só confere e descreve o que vai acontecer (nada é gravado);
   - "apply" confere de novo item a item e grava; cada item vira um registro no histórico
     com a ficha antes e depois, e todos do mesmo "aplicar" ficam no mesmo lote;
   - "undo" volta a ficha ao que era antes (um item ou o lote inteiro). */

export type SheetRow = {
  publicId: string | number;
  name: string;
  birthDate?: string | null; // yyyy-mm-dd
  age?: number | null;
  gift?: string | null;
  mother?: string | null;
};

export type SponsorshipDecision = { id: string; decision: 'cancel' | 'replace'; replacementChildId?: string | null };

/** Escola escolhida na tela (ligação "escola da planilha → escola do site") ou uma nova a criar */
export type SchoolChoice = { schoolId?: string | null; newName?: string | null };

export type SyncItem =
  | { op: 'create'; key: string; cityId: string; community?: string | null; school?: SchoolChoice | null; row: SheetRow; photoFileId?: string | null; useChildId?: string | null; forceNew?: boolean }
  | { op: 'update'; key: string; childId: string; cityId?: string | null; fields: { name?: string; gift?: string; birthDate?: string; community?: string; school?: SchoolChoice } }
  | { op: 'renumber'; key: string; childId: string; publicId: number }
  | { op: 'photo'; key: string; childId: string; photoFileId: string }
  | { op: 'remove'; key: string; childId: string; sponsorship?: SponsorshipDecision | null };

type CommunityPlan = { action: 'none' | 'existing' | 'reactivate' | 'create'; id?: string; name: string; similarTo?: string };
/** linkCommunity: a escola ainda não atende a comunidade da criança e passa a atender */
type SchoolPlan = { action: 'none' | 'existing' | 'create'; id?: string; name: string; linkCommunity?: boolean };

type ChildBrief = { id: string; publicId: number; name: string; community: string | null; birthDate: string | null; age: number | null; inCampaign: boolean };

export type PlanResult = {
  key: string;
  op: SyncItem['op'];
  ok: boolean;
  error?: string;
  warnings: string[];
  effects: string[];
  child?: { id: string; name: string; publicId: number } | null;
  /** create: usa um cadastro que já existe (de outra campanha) ou cria um novo */
  match?: { kind: 'new' } | { kind: 'reuse'; child: ChildBrief; reason: string };
  candidates?: ChildBrief[];
  community?: CommunityPlan;
  school?: SchoolPlan;
  /** remove: apadrinhamentos desta criança nesta campanha */
  sponsorships?: SponsorshipDetail[];
  needsDecision?: boolean;
  replacements?: ReplacementOption[];
};

type SponsorshipDetail = {
  id: string;
  status: SponsorshipStatus;
  method: string;
  donationAmount: string | null;
  pixPaidAt: Date | null;
  createdAt: Date;
  note: string | null;
  sponsor: { id: string; name: string; email: string; phone: string | null };
  collectionPoint: { name: string; cityName: string | null } | null;
  /** precisa de decisão (cancelar ou trocar) para tirar a criança */
  blocking: boolean;
  /** já concluído: não dá para tirar a criança pela conferência */
  locked: boolean;
};

type ReplacementOption = { id: string; publicId: number; name: string; community: string | null; age: number | null; gift: string | null; hasPhoto: boolean };

/** Ficha da criança numa campanha: o que é guardado no histórico e devolvido ao desfazer */
type Snapshot = {
  child: {
    id: string; publicId: number; name: string; birthDate: string | null; age: number | null; motherName: string | null;
    wantedGift: string | null; cityId: string | null; cityName: string; communityId: string | null; communityName: string | null;
    schoolId: string | null; photoUrl: string | null; deletedAt: string | null;
  };
  include: { sourceCampaignId: string | null } | null;
  campaignData: { publicId: number | null; wantedGift: string | null } | null;
  images: Record<string, any>[];
  sponsorships: { id: string; status: SponsorshipStatus; childId: string; note: string | null; sponsorName: string | null }[];
};

const UNDOABLE = ['child.create', 'child.update', 'child.renumber', 'child.photo', 'child.remove'];
const LOCKED: SponsorshipStatus[] = [SponsorshipStatus.COMPLETED, SponsorshipStatus.ENDED];
const SOURCE = 'source-check';

const normalize = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Parecença de 0 a 1 (pares de letras), sem acento e sem espaços */
function similarity(a: string, b: string) {
  const x = normalize(a).replace(/ /g, ''), y = normalize(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const pairs = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) ?? 0) + 1); } return m; };
  const px = pairs(x), py = pairs(y);
  let hit = 0;
  for (const [p, n] of px) hit += Math.min(n, py.get(p) ?? 0);
  return (2 * hit) / (x.length - 1 + y.length - 1);
}

const ageOf = (birth: Date | null, age: number | null) => {
  if (!birth) return age;
  const now = new Date();
  let a = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) a--;
  return a;
};
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const brDay = (iso?: string | null) => { const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : 'vazio'; };
const toDate = (v: unknown) => (v ? new Date(String(v)) : null);

@Injectable()
export class SourceSyncService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private updater: ChildrenUpdateService,
    private childImages: ChildImagesService,
    private frames: CampaignFramesService,
    private google: GoogleClient,
    private storage: StorageService,
  ) {}

  /* ————————————————————— apoio ————————————————————— */

  private async campaign(campaignId: string) {
    if (!campaignId) throw new BadRequestException('Escolha a campanha.');
    const c = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, publicId: true, frameKey: true, frameUrl: true, frameConfig: true },
    });
    if (!c) throw new NotFoundException('Campanha não encontrada.');
    return c;
  }

  private inCampaign(campaignId: string): Prisma.ChildWhereInput {
    return { OR: [{ images: { some: { campaignId } } }, { campaignIncludes: { some: { campaignId } } }] };
  }

  /** Ficha completa da criança nesta campanha (para o histórico e para desfazer) */
  private async snapshot(childId: string, campaignId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Snapshot | null> {
    const c = await db.child.findUnique({
      where: { id: childId },
      select: {
        id: true, publicId: true, name: true, birthDate: true, age: true, motherName: true, wantedGift: true,
        cityId: true, cityName: true, communityId: true, schoolId: true, photoUrl: true, deletedAt: true,
        community: { select: { name: true } },
        campaignIncludes: { where: { campaignId }, select: { sourceCampaignId: true } },
        campaignData: { where: { campaignId }, select: { publicId: true, wantedGift: true } },
        images: { where: { campaignId }, orderBy: { createdAt: 'asc' } },
        sponsorships: { where: { campaignId }, select: { id: true, status: true, childId: true, note: true, sponsor: { select: { name: true } } } },
      },
    });
    if (!c) return null;
    return {
      child: {
        id: c.id, publicId: c.publicId, name: c.name, birthDate: isoDay(c.birthDate), age: c.age, motherName: c.motherName,
        wantedGift: c.wantedGift, cityId: c.cityId, cityName: c.cityName, communityId: c.communityId,
        communityName: c.community?.name ?? null, schoolId: c.schoolId, photoUrl: c.photoUrl,
        deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
      },
      include: c.campaignIncludes[0] ? { sourceCampaignId: c.campaignIncludes[0].sourceCampaignId } : null,
      campaignData: c.campaignData[0] ?? null,
      images: c.images.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() })),
      sponsorships: c.sponsorships.map((s) => ({ id: s.id, status: s.status, childId: s.childId, note: s.note, sponsorName: s.sponsor?.name ?? null })),
    };
  }

  private campaignPid(s: Snapshot | null) {
    return s ? s.campaignData?.publicId ?? s.child.publicId : null;
  }

  private brief(c: { id: string; publicId: number; name: string; birthDate: Date | null; age: number | null; community: { name: string } | null; campaignData: { publicId: number | null }[]; campaignIncludes: unknown[]; images: unknown[] }): ChildBrief {
    return {
      id: c.id,
      publicId: c.campaignData[0]?.publicId ?? c.publicId,
      name: c.name,
      community: c.community?.name ?? null,
      birthDate: isoDay(c.birthDate),
      age: ageOf(c.birthDate, c.age),
      inCampaign: c.campaignIncludes.length > 0 || c.images.length > 0,
    };
  }

  private communityCache = new Map<string, { id: string; name: string; deletedAt: Date | null }[]>();

  private async communities(cityId: string, fresh = false) {
    if (fresh || !this.communityCache.has(cityId)) {
      this.communityCache.set(cityId, await this.prisma.community.findMany({ where: { cityId }, select: { id: true, name: true, deletedAt: true } }));
    }
    return this.communityCache.get(cityId)!;
  }

  /** Comunidade da planilha → a do site (mesmo nome sem acento; ou muito parecida) ou nova */
  private async planCommunity(cityId: string, raw?: string | null): Promise<CommunityPlan> {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return { action: 'none', name: '' };
    const list = await this.communities(cityId);
    const same = list.filter((c) => normalize(c.name) === normalize(name));
    const active = same.find((c) => !c.deletedAt);
    if (active) return { action: 'existing', id: active.id, name: active.name };
    if (same[0]) return { action: 'reactivate', id: same[0].id, name: same[0].name };
    const close = list.filter((c) => !c.deletedAt && similarity(c.name, name) >= 0.88);
    if (close.length === 1) return { action: 'existing', id: close[0].id, name: close[0].name, similarTo: name };
    return { action: 'create', name };
  }

  private async ensureCommunity(cityId: string, plan: CommunityPlan, actor: AuditActor, ctx: { campaignId: string; batchId: string }) {
    if (plan.action === 'none') return null;
    if (plan.action === 'existing') return plan.id!;
    if (plan.action === 'reactivate') {
      await this.prisma.community.update({ where: { id: plan.id! }, data: { deletedAt: null } });
      await this.audit.record(actor, {
        action: 'community.reactivate', entity: 'Community', entityId: plan.id, source: SOURCE, ...ctx,
        summary: `Reativou a comunidade "${plan.name}" (estava excluída) para receber crianças da planilha`,
      });
      await this.communities(cityId, true);
      return plan.id!;
    }
    // pode ter sido criada por outro item deste mesmo lote
    const again = await this.planCommunity(cityId, plan.name);
    if (again.action !== 'create') return this.ensureCommunity(cityId, again, actor, ctx);
    const city = await this.prisma.city.findUnique({ where: { id: cityId }, select: { name: true } });
    const created = await this.prisma.community.create({ data: { cityId, name: plan.name }, select: { id: true, name: true } });
    await this.audit.record(actor, {
      action: 'community.create', entity: 'Community', entityId: created.id, source: SOURCE, ...ctx,
      summary: `Criou a comunidade "${created.name}" em ${city?.name ?? 'cidade'} (veio da planilha)`,
      after: created,
    });
    await this.communities(cityId, true);
    return created.id;
  }

  private communityEffect(p: CommunityPlan) {
    if (p.action === 'create') return `Cria a comunidade "${p.name}"`;
    if (p.action === 'reactivate') return `Reativa a comunidade "${p.name}" (estava excluída)`;
    return null;
  }

  /** Escola escolhida → a do site (tem de ser da cidade) ou uma nova; diz se precisa ligar à comunidade */
  private async planSchool(cityId: string, choice: SchoolChoice | null | undefined, community: { id?: string | null; action?: string } | null): Promise<SchoolPlan> {
    const id = choice?.schoolId?.trim();
    const newName = String(choice?.newName ?? '').trim().replace(/\s+/g, ' ');
    if (!id && !newName) return { action: 'none', name: '' };
    const communityId = community?.id ?? null;
    const willCreateCommunity = community?.action === 'create';
    if (id) {
      const sc = await this.prisma.school.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, cityId: true, communities: { select: { communityId: true } } },
      });
      if (!sc) throw new Error('A escola escolhida não existe mais.');
      if (sc.cityId !== cityId) throw new Error(`A escola "${sc.name}" não é da cidade da criança.`);
      const linked = !!communityId && sc.communities.some((c) => c.communityId === communityId);
      return { action: 'existing', id: sc.id, name: sc.name, linkCommunity: willCreateCommunity || (!!communityId && !linked) };
    }
    // nova: se já existe uma com o mesmo nome na cidade, usa ela
    const same = (await this.prisma.school.findMany({
      where: { cityId, deletedAt: null },
      select: { id: true, name: true, communities: { select: { communityId: true } } },
    })).find((x) => normalize(x.name) === normalize(newName));
    if (same) {
      const linked = !!communityId && same.communities.some((c) => c.communityId === communityId);
      return { action: 'existing', id: same.id, name: same.name, linkCommunity: willCreateCommunity || (!!communityId && !linked) };
    }
    return { action: 'create', name: newName, linkCommunity: true };
  }

  private schoolEffects(p: SchoolPlan, communityName: string | null) {
    const out: string[] = [];
    if (p.action === 'create') out.push(`Cria a escola "${p.name}"${communityName ? ` atendendo a comunidade ${communityName}` : ''}`);
    else if (p.linkCommunity && communityName) out.push(`Passa a escola "${p.name}" a atender também a comunidade ${communityName}`);
    return out;
  }

  /** Cria a escola (ou liga à comunidade) e devolve o id; registra no histórico */
  private async ensureSchool(cityId: string, plan: SchoolPlan, communityId: string | null, actor: AuditActor, ctx: { campaignId: string; batchId: string }): Promise<string | null> {
    if (plan.action === 'none') return null;
    if (plan.action === 'create') {
      // outro item do mesmo lote pode ter criado
      const again = await this.planSchool(cityId, { newName: plan.name }, communityId ? { id: communityId } : null);
      if (again.action === 'existing') return this.ensureSchool(cityId, again, communityId, actor, ctx);
      const city = await this.prisma.city.findUnique({ where: { id: cityId }, select: { name: true } });
      const created = await this.prisma.school.create({
        data: { cityId, name: plan.name, communityId, ...(communityId ? { communities: { create: { communityId } } } : {}) },
        select: { id: true, name: true },
      });
      await this.audit.record(actor, {
        action: 'school.create', entity: 'School', entityId: created.id, source: SOURCE, ...ctx,
        summary: `Criou a escola "${created.name}" em ${city?.name ?? 'cidade'} (veio da planilha)`,
        after: { ...created, communityId },
      });
      return created.id;
    }
    const id = plan.id ?? null;
    if (id && communityId && plan.linkCommunity) {
      const res = await this.prisma.schoolCommunity.createMany({ data: [{ schoolId: id, communityId }], skipDuplicates: true });
      await this.prisma.school.updateMany({ where: { id, communityId: null }, data: { communityId } });
      if (res.count) {
        const cm = await this.prisma.community.findUnique({ where: { id: communityId }, select: { name: true } });
        await this.audit.record(actor, {
          action: 'school.link', entity: 'School', entityId: id, source: SOURCE, ...ctx,
          summary: `A escola "${plan.name}" passou a atender a comunidade ${cm?.name ?? ''} (veio da planilha)`,
          after: { schoolId: id, communityId },
        });
      }
    }
    return id;
  }

  private async assertPidFree(campaignId: string, pid: number, childId?: string) {
    const taken = await this.prisma.childCampaignData.findFirst({
      where: { campaignId, publicId: pid, ...(childId ? { childId: { not: childId } } : {}) },
      select: { child: { select: { name: true } } },
    });
    if (taken) throw new Error(`O ID ${pid} já é de ${taken.child.name} nesta campanha.`);
  }

  /* ————————————————————— conferir (plan) ————————————————————— */

  /**
   * Cadastra comunidades e escolas que estão na planilha e faltam no site (escolhidas na tela).
   * Comunidade com o mesmo nome (sem acento/maiúscula) é reaproveitada; excluída é reativada.
   * Escola é ligada às comunidades que atende (inclusive as criadas nesta mesma chamada).
   */
  async register(
    campaignId: string,
    batchId: string,
    body: {
      communities?: { cityId: string; name: string }[];
      schools?: { cityId: string; name: string; communityNames?: string[] }[];
    },
    actor: AuditActor,
  ) {
    await this.campaign(campaignId);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(batchId ?? '')) throw new BadRequestException('Lote inválido.');
    this.communityCache.clear();
    const ctx = { campaignId, batchId };
    const cityOk = async (cityId: string) => !!cityId && !!(await this.prisma.city.findUnique({ where: { id: cityId }, select: { id: true } }));

    const communities: { cityId: string; name: string; ok: boolean; id?: string; status?: string; message?: string }[] = [];
    for (const c of (body.communities ?? []).slice(0, 300)) {
      const name = String(c?.name ?? '').trim().replace(/\s+/g, ' ');
      try {
        if (!name) throw new Error('Nome vazio.');
        if (!(await cityOk(c.cityId))) throw new Error('Cidade não encontrada.');
        const plan = await this.planCommunity(c.cityId, name);
        const id = await this.ensureCommunity(c.cityId, plan, actor, ctx);
        communities.push({ cityId: c.cityId, name: plan.name, ok: true, id: id ?? undefined, status: plan.action === 'existing' ? 'já existia' : plan.action === 'reactivate' ? 'reativada' : 'criada' });
      } catch (e: any) {
        communities.push({ cityId: c.cityId, name, ok: false, message: e?.message ?? 'Falha.' });
      }
    }

    const schools: { cityId: string; name: string; ok: boolean; id?: string; status?: string; message?: string }[] = [];
    for (const s of (body.schools ?? []).slice(0, 300)) {
      const name = String(s?.name ?? '').trim().replace(/\s+/g, ' ');
      try {
        if (!name) throw new Error('Nome vazio.');
        if (!(await cityOk(s.cityId))) throw new Error('Cidade não encontrada.');
        // comunidades atendidas (precisam existir; as que faltarem ficam de fora, com aviso)
        const ids: string[] = [];
        const missing: string[] = [];
        for (const cn of s.communityNames ?? []) {
          const p = await this.planCommunity(s.cityId, cn);
          if (p.action === 'existing' && p.id) ids.push(p.id);
          else if (p.action !== 'none') missing.push(cn);
        }
        const plan = await this.planSchool(s.cityId, { newName: name }, ids[0] ? { id: ids[0] } : null);
        const id = await this.ensureSchool(s.cityId, plan, ids[0] ?? null, actor, ctx);
        for (const cid of ids.slice(1)) {
          await this.ensureSchool(s.cityId, { action: 'existing', id: id!, name: plan.name, linkCommunity: true }, cid, actor, ctx);
        }
        schools.push({
          cityId: s.cityId, name: plan.name, ok: true, id: id ?? undefined,
          status: plan.action === 'existing' ? 'já existia (ligada às comunidades)' : 'criada',
          message: missing.length ? `Comunidade(s) não cadastrada(s), sem ligação: ${missing.join(', ')}` : undefined,
        });
      } catch (e: any) {
        schools.push({ cityId: s.cityId, name, ok: false, message: e?.message ?? 'Falha.' });
      }
    }
    return { batchId, communities, schools };
  }

  async plan(campaignId: string, itemsRaw: SyncItem[]) {
    await this.campaign(campaignId);
    this.communityCache.clear();
    const items = this.clean(itemsRaw);
    const removing = new Set(items.filter((i) => i.op === 'remove').map((i) => i.childId));
    const results: PlanResult[] = [];
    for (const item of items) results.push(await this.planOne(campaignId, item, removing));
    return { results };
  }

  private clean(itemsRaw: SyncItem[]): SyncItem[] {
    if (!Array.isArray(itemsRaw)) throw new BadRequestException('Nenhum item enviado.');
    if (itemsRaw.length > 2000) throw new BadRequestException('Envie no máximo 2000 itens por vez.');
    return itemsRaw.filter((i) => i && typeof i.key === 'string' && ['create', 'update', 'renumber', 'photo', 'remove'].includes(i.op));
  }

  private async planOne(campaignId: string, item: SyncItem, removing: Set<string>): Promise<PlanResult> {
    const base: PlanResult = { key: item.key, op: item.op, ok: true, warnings: [], effects: [] };
    try {
      switch (item.op) {
        case 'create': return await this.planCreate(campaignId, item, base);
        case 'update': return await this.planUpdate(campaignId, item, base);
        case 'renumber': return await this.planRenumber(campaignId, item, base);
        case 'photo': return await this.planPhoto(campaignId, item, base);
        case 'remove': return await this.planRemove(campaignId, item, base, removing);
      }
    } catch (e: any) {
      return { ...base, ok: false, error: e?.message ?? 'Falha ao conferir.' };
    }
  }

  private async childInCampaign(campaignId: string, childId: string) {
    const s = await this.snapshot(childId, campaignId);
    if (!s || s.child.deletedAt) throw new Error('A criança não existe mais no site.');
    if (!s.include && !s.images.length) throw new Error('A criança não faz mais parte desta campanha.');
    return s;
  }

  private async planCreate(campaignId: string, item: Extract<SyncItem, { op: 'create' }>, out: PlanResult): Promise<PlanResult> {
    const r = item.row ?? ({} as SheetRow);
    const name = String(r.name ?? '').trim();
    const pid = parseInt(String(r.publicId), 10);
    if (name.length < 2) throw new Error('Nome ausente na planilha.');
    if (!Number.isFinite(pid)) throw new Error('ID inválido na planilha.');
    const city = await this.prisma.city.findUnique({ where: { id: item.cityId ?? '' }, select: { id: true, name: true } });
    if (!city) throw new Error('Cidade não encontrada.');

    out.community = await this.planCommunity(city.id, item.community);
    const ce = this.communityEffect(out.community);
    if (ce) out.effects.push(ce);
    if (out.community.similarTo) out.warnings.push(`Comunidade "${out.community.similarTo}" da planilha ligada a "${out.community.name}" do site (nome parecido).`);
    out.school = await this.planSchool(city.id, item.school, out.community);
    out.effects.push(...this.schoolEffects(out.school, out.community.name || null));

    // parecidas na cidade (para escolher usar um cadastro existente)
    const select = {
      id: true, publicId: true, name: true, birthDate: true, age: true,
      community: { select: { name: true } },
      campaignData: { where: { campaignId }, select: { publicId: true } },
      campaignIncludes: { where: { campaignId }, select: { id: true } },
      images: { where: { campaignId }, select: { id: true }, take: 1 },
    } satisfies Prisma.ChildSelect;
    const inCity = await this.prisma.child.findMany({ where: { cityId: city.id, deletedAt: null }, select });
    out.candidates = inCity
      .map((c) => ({ c, s: similarity(c.name, name) }))
      .filter((x) => x.s >= 0.8)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => this.brief(x.c));

    if (item.useChildId) {
      const chosen = await this.prisma.child.findFirst({ where: { id: item.useChildId, deletedAt: null }, select });
      if (!chosen) throw new Error('O cadastro escolhido não existe mais.');
      await this.assertPidFree(campaignId, pid, chosen.id);
      out.match = { kind: 'reuse', child: this.brief(chosen), reason: 'escolhido na tela' };
    } else if (!item.forceNew) {
      const [p] = (await this.updater.preview(
        [{ key: item.key, publicId: pid, name, birthDate: r.birthDate ?? null, age: r.age ?? null, motherName: r.mother ?? null, wantedGift: r.gift ?? null }],
        { campaignId, cityId: city.id },
      )).rows;
      if (p.action === 'update' && p.child) {
        if (p.matchedBy === 'campaignId') {
          throw new Error(`O ID ${pid} já é de ${p.child.name} nesta campanha. Corrija a planilha ou o ID no site.`);
        }
        const full = inCity.find((c) => c.id === p.child!.id);
        const b: ChildBrief = full ? this.brief(full) : { id: p.child.id, publicId: p.child.publicId, name: p.child.name, community: p.child.communityName, birthDate: p.child.birthDate, age: p.child.age, inCampaign: p.child.inCampaign };
        out.match = {
          kind: 'reuse',
          child: b,
          reason: p.matchedBy === 'mainId' ? 'mesmo ID e mesmo nome no cadastro' : 'mesmo nome na cidade',
        };
      } else if (p.warnings.length) {
        throw new Error(`${p.warnings.join(' ')} Escolha o cadastro certo ou marque "cadastrar como nova".`);
      }
    }
    if (!out.match) {
      await this.assertPidFree(campaignId, pid);
      out.match = { kind: 'new' };
      const close = (out.candidates ?? []).filter((c) => !c.inCampaign);
      if (close.length) out.warnings.push(`Parecida com ${close.map((c) => `${c.name} (ID ${c.publicId})`).join(', ')} — confira se não é a mesma criança.`);
    }

    out.effects.unshift(
      out.match.kind === 'reuse'
        ? `Coloca na campanha o cadastro de ${out.match.child.name} (${out.match.reason}) com o ID ${pid} e os dados da planilha`
        : `Cadastra ${name} com o ID ${pid} em ${city.name}${out.community.name ? ` / ${out.community.name}` : ''}`,
    );
    out.effects.splice(1, 0, out.school.action === 'none' ? 'Sem escola definida (fica sem escola)' : `Escola: ${out.school.name}`);
    out.effects.push(item.photoFileId ? 'Traz a foto do Drive' : 'Sem foto no Drive (fica sem foto)');
    return out;
  }

  private async planUpdate(campaignId: string, item: Extract<SyncItem, { op: 'update' }>, out: PlanResult): Promise<PlanResult> {
    const s = await this.childInCampaign(campaignId, item.childId);
    out.child = { id: s.child.id, name: s.child.name, publicId: this.campaignPid(s)! };
    const f = item.fields ?? {};
    const gift = s.campaignData ? s.campaignData.wantedGift : s.child.wantedGift;
    if (f.name?.trim() && f.name.trim() !== s.child.name) out.effects.push(`Nome: ${s.child.name} → ${f.name.trim()}`);
    if (f.gift?.trim() && f.gift.trim() !== (gift ?? '')) out.effects.push(`Presente: ${gift || 'vazio'} → ${f.gift.trim()}`);
    if (f.birthDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate)) throw new Error('Data de nascimento inválida.');
      if (f.birthDate !== s.child.birthDate) out.effects.push(`Nascimento: ${brDay(s.child.birthDate)} → ${brDay(f.birthDate)}`);
    }
    if (f.community?.trim()) {
      const cityId = s.child.cityId ?? item.cityId;
      if (!cityId) throw new Error('A criança está sem cidade no site.');
      out.community = await this.planCommunity(cityId, f.community);
      if (out.community.id !== s.child.communityId) {
        out.effects.push(`Comunidade: ${s.child.communityName ?? 'vazio'} → ${out.community.name}`);
        const ce = this.communityEffect(out.community);
        if (ce) out.effects.push(ce);
      }
      if (out.community.similarTo) out.warnings.push(`Comunidade "${out.community.similarTo}" ligada a "${out.community.name}" do site (nome parecido).`);
    }
    if (f.school && (f.school.schoolId || f.school.newName)) {
      const cityId = s.child.cityId ?? item.cityId;
      if (!cityId) throw new Error('A criança está sem cidade no site.');
      const comm = out.community && out.community.action !== 'none'
        ? out.community
        : { id: s.child.communityId, action: 'existing', name: s.child.communityName ?? '' };
      out.school = await this.planSchool(cityId, f.school, comm);
      if (out.school.id !== s.child.schoolId || out.school.action === 'create') {
        out.effects.push(`Escola: ${s.child.schoolId ? await this.schoolName(s.child.schoolId) : 'vazio'} → ${out.school.name}`);
      }
      out.effects.push(...this.schoolEffects(out.school, comm.name || null));
    }
    if (!out.effects.length) out.warnings.push('Nada a mudar: o site já está igual.');
    return out;
  }

  private async schoolName(id: string) {
    return (await this.prisma.school.findUnique({ where: { id }, select: { name: true } }))?.name ?? 'escola';
  }

  private async planRenumber(campaignId: string, item: Extract<SyncItem, { op: 'renumber' }>, out: PlanResult): Promise<PlanResult> {
    const s = await this.childInCampaign(campaignId, item.childId);
    const pid = Number(item.publicId);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('ID inválido.');
    out.child = { id: s.child.id, name: s.child.name, publicId: this.campaignPid(s)! };
    await this.assertPidFree(campaignId, pid, s.child.id);
    if (this.campaignPid(s) === pid) out.warnings.push('O ID já é este.');
    else out.effects.push(`ID nesta campanha: ${this.campaignPid(s)} → ${pid}`);
    return out;
  }

  private async planPhoto(campaignId: string, item: Extract<SyncItem, { op: 'photo' }>, out: PlanResult): Promise<PlanResult> {
    const s = await this.childInCampaign(campaignId, item.childId);
    if (!item.photoFileId) throw new Error('Foto do Drive não informada.');
    out.child = { id: s.child.id, name: s.child.name, publicId: this.campaignPid(s)! };
    out.effects.push(s.images.length ? 'Troca a foto pela do Drive (a anterior fica guardada)' : 'Coloca a foto do Drive');
    return out;
  }

  private sponsorshipSelect = {
    id: true, status: true, method: true, donationAmount: true, pixPaidAt: true, createdAt: true, note: true, childId: true,
    sponsor: { select: { id: true, name: true, email: true, phone: true } },
    collectionPoint: { select: { name: true, cityName: true } },
  } satisfies Prisma.SponsorshipSelect;

  private async planRemove(campaignId: string, item: Extract<SyncItem, { op: 'remove' }>, out: PlanResult, removing: Set<string>): Promise<PlanResult> {
    const s = await this.childInCampaign(campaignId, item.childId);
    out.child = { id: s.child.id, name: s.child.name, publicId: this.campaignPid(s)! };
    const rows = await this.prisma.sponsorship.findMany({ where: { campaignId, childId: s.child.id }, select: this.sponsorshipSelect, orderBy: { createdAt: 'desc' } });
    out.sponsorships = rows.map((r) => ({
      id: r.id,
      status: r.status,
      method: r.method,
      donationAmount: r.donationAmount ? r.donationAmount.toString() : null,
      pixPaidAt: r.pixPaidAt,
      createdAt: r.createdAt,
      note: r.note,
      sponsor: r.sponsor,
      collectionPoint: r.collectionPoint,
      blocking: r.status !== SponsorshipStatus.CANCELLED,
      locked: LOCKED.includes(r.status),
    }));
    const blocking = out.sponsorships.filter((x) => x.blocking);
    const locked = blocking.find((x) => x.locked);
    if (locked) throw new Error(`O apadrinhamento de ${locked.sponsor.name} já está ${locked.status === 'COMPLETED' ? 'concluído' : 'encerrado'}: a criança não pode sair da campanha por aqui.`);

    out.effects.push(`Tira ${s.child.name} (ID ${this.campaignPid(s)}) da campanha — o cadastro e as outras campanhas continuam`);
    if (s.images.length) out.effects.push('A foto desta campanha sai da lista (o arquivo fica guardado)');

    if (blocking.length) {
      out.needsDecision = true;
      out.replacements = await this.replacements(campaignId, s, removing);
      const d = item.sponsorship;
      const active = blocking[0];
      if (!d) {
        out.warnings.push(`Tem padrinho: ${active.sponsor.name}. Escolha cancelar o apadrinhamento ou trocar por outra criança.`);
      } else if (d.id !== active.id) {
        throw new Error('O apadrinhamento desta criança mudou desde a conferência. Confira de novo.');
      } else if (d.decision === 'cancel') {
        out.effects.push(`Cancela o apadrinhamento de ${active.sponsor.name}`);
      } else if (d.decision === 'replace') {
        const rep = await this.checkReplacement(campaignId, d.replacementChildId, s.child.id, removing);
        out.effects.push(`Passa o apadrinhamento de ${active.sponsor.name} para ${rep.name} (ID ${rep.publicId})`);
      } else {
        throw new Error('Decisão do apadrinhamento inválida.');
      }
    }
    return out;
  }

  /** Crianças da campanha sem nenhum apadrinhamento, primeiro da mesma comunidade e idade parecida */
  private async replacements(campaignId: string, s: Snapshot, removing: Set<string>): Promise<ReplacementOption[]> {
    if (!s.child.cityId) return [];
    const rows = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        cityId: s.child.cityId,
        id: { notIn: [s.child.id, ...removing] },
        sponsorships: { none: { campaignId } },
        AND: [this.inCampaign(campaignId)],
      },
      select: {
        id: true, publicId: true, name: true, birthDate: true, age: true, wantedGift: true, communityId: true,
        community: { select: { name: true } },
        campaignData: { where: { campaignId }, select: { publicId: true, wantedGift: true } },
        images: { where: { campaignId }, select: { id: true }, take: 1 },
      },
      take: 1000,
    });
    const myAge = s.child.birthDate ? ageOf(new Date(s.child.birthDate), s.child.age) : s.child.age;
    return rows
      .map((c) => ({
        c,
        age: ageOf(c.birthDate, c.age),
        score: (c.communityId && c.communityId === s.child.communityId ? 0 : 100) + (myAge != null ? Math.abs((ageOf(c.birthDate, c.age) ?? 99) - myAge) : 0),
      }))
      .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name, 'pt-BR'))
      .slice(0, 30)
      .map(({ c, age }) => ({
        id: c.id,
        publicId: c.campaignData[0]?.publicId ?? c.publicId,
        name: c.name,
        community: c.community?.name ?? null,
        age,
        gift: c.campaignData[0] ? c.campaignData[0].wantedGift : c.wantedGift,
        hasPhoto: c.images.length > 0,
      }));
  }

  private async checkReplacement(campaignId: string, replacementId: string | null | undefined, fromId: string, removing: Set<string>) {
    if (!replacementId) throw new Error('Escolha a criança que vai receber o apadrinhamento.');
    if (replacementId === fromId || removing.has(replacementId)) throw new Error('A criança escolhida para a troca também está saindo.');
    const rep = await this.prisma.child.findFirst({
      where: { id: replacementId, deletedAt: null, AND: [this.inCampaign(campaignId)] },
      select: { id: true, name: true, publicId: true, campaignData: { where: { campaignId }, select: { publicId: true } }, sponsorships: { where: { campaignId }, select: { id: true } } },
    });
    if (!rep) throw new Error('A criança escolhida para a troca não está nesta campanha.');
    if (rep.sponsorships.length) throw new Error(`${rep.name} já tem apadrinhamento nesta campanha.`);
    return { id: rep.id, name: rep.name, publicId: rep.campaignData[0]?.publicId ?? rep.publicId };
  }

  /* ————————————————————— gravar (apply) ————————————————————— */

  async apply(campaignId: string, batchId: string, itemsRaw: SyncItem[], actor: AuditActor) {
    const campaign = await this.campaign(campaignId);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(batchId ?? '')) throw new BadRequestException('Lote inválido.');
    const items = this.clean(itemsRaw);
    if (items.length > 50) throw new BadRequestException('Envie no máximo 50 itens por vez.');
    this.communityCache.clear();
    const removing = new Set(items.filter((i) => i.op === 'remove').map((i) => i.childId));
    const ctx = { campaignId, batchId };

    const results: { key: string; ok: boolean; message?: string; childId?: string; auditId?: string }[] = [];
    for (const item of items) {
      try {
        // confere de novo, com o banco de agora
        const plan = await this.planOne(campaignId, item, removing);
        if (!plan.ok) throw new Error(plan.error);
        if (plan.needsDecision && !(item.op === 'remove' && item.sponsorship)) throw new Error('Tem padrinho: escolha cancelar ou trocar antes de tirar da campanha.');
        const done = await this.applyOne(campaign, item, plan, actor, ctx);
        results.push({ key: item.key, ok: true, ...done });
      } catch (e: any) {
        results.push({ key: item.key, ok: false, message: e?.message ?? 'Falha ao gravar.' });
      }
    }
    return { batchId, results };
  }

  private async applyOne(
    campaign: Awaited<ReturnType<SourceSyncService['campaign']>>,
    item: SyncItem,
    plan: PlanResult,
    actor: AuditActor,
    ctx: { campaignId: string; batchId: string },
  ): Promise<{ childId: string; auditId?: string; message?: string }> {
    const campaignId = campaign.id;
    const fail = (r: { errors: { message: string }[] }) => { if (r.errors.length) throw new Error(r.errors.map((e) => e.message).join(' ')); };

    if (item.op === 'create') {
      const r = item.row;
      const pid = parseInt(String(r.publicId), 10);
      const communityId = await this.ensureCommunity(item.cityId, plan.community!, actor, ctx);
      const schoolId = plan.school ? await this.ensureSchool(item.cityId, plan.school, communityId, actor, ctx) : null;
      const context = { campaignId, cityId: item.cityId, communityId, schoolId };
      let childId: string;
      let before: Snapshot | null = null;
      if (plan.match?.kind === 'reuse') {
        childId = plan.match.child.id;
        before = await this.snapshot(childId, campaignId);
        fail(await this.updater.apply({
          context,
          updates: [{
            key: item.key, childId,
            fields: {
              name: r.name, birthDate: r.birthDate ?? undefined, age: r.age ?? undefined, motherName: r.mother ?? undefined,
              wantedGift: r.gift ?? undefined, campaignPublicId: pid, location: true,
            },
          }],
        }));
      } else {
        const res = await this.updater.apply({
          context,
          creates: [{ key: item.key, publicId: pid, name: r.name, birthDate: r.birthDate ?? null, age: r.age ?? null, motherName: r.mother ?? null, wantedGift: r.gift ?? null }],
        });
        fail(res);
        childId = res.ids[item.key];
      }
      let message: string | undefined;
      if (item.photoFileId) {
        try { await this.importPhoto(campaign, childId, item.photoFileId); }
        catch (e: any) { message = `Cadastrada, mas a foto não veio: ${e?.message ?? 'erro'}`; }
      }
      const after = await this.snapshot(childId, campaignId);
      const rec = await this.audit.record(actor, {
        action: 'child.create', entity: 'Child', entityId: childId, source: SOURCE, ...ctx,
        summary: plan.match?.kind === 'reuse'
          ? `Colocou ${after?.child.name} (ID ${pid}) na campanha usando o cadastro existente, com os dados da planilha`
          : `Cadastrou ${after?.child.name} (ID ${pid}) da planilha${item.photoFileId && !message ? ', com foto do Drive' : ''}`,
        before, after,
        meta: { reused: plan.match?.kind === 'reuse', createdNew: plan.match?.kind !== 'reuse', photoFileId: item.photoFileId ?? null, photoError: message ?? null },
      });
      return { childId, auditId: rec?.id, message };
    }

    if (item.op === 'update') {
      const before = (await this.snapshot(item.childId, campaignId))!;
      const cityId = before.child.cityId ?? item.cityId!;
      const f = item.fields ?? {};
      const communityId = plan.community && plan.community.action !== 'none' ? await this.ensureCommunity(cityId, plan.community, actor, ctx) : null;
      const moveCommunity = !!communityId && communityId !== before.child.communityId;
      const schoolId = plan.school && plan.school.action !== 'none'
        ? await this.ensureSchool(cityId, plan.school, communityId ?? before.child.communityId, actor, ctx)
        : null;
      const changeSchool = !!schoolId && schoolId !== before.child.schoolId;
      fail(await this.updater.apply({
        context: { campaignId, cityId, communityId: moveCommunity ? communityId : null, schoolId: changeSchool ? schoolId : null },
        updates: [{ key: item.key, childId: item.childId, fields: { name: f.name, wantedGift: f.gift, birthDate: f.birthDate, location: moveCommunity || changeSchool } }],
      }));
      const after = await this.snapshot(item.childId, campaignId);
      const rec = await this.audit.record(actor, {
        action: 'child.update', entity: 'Child', entityId: item.childId, source: SOURCE, ...ctx,
        summary: `Atualizou ${before.child.name} (ID ${this.campaignPid(before)}) pela planilha: ${plan.effects.join('; ')}`,
        before, after,
      });
      return { childId: item.childId, auditId: rec?.id };
    }

    if (item.op === 'renumber') {
      const before = (await this.snapshot(item.childId, campaignId))!;
      const cityId = before.child.cityId;
      if (!cityId) throw new Error('A criança está sem cidade no site.');
      fail(await this.updater.apply({
        context: { campaignId, cityId },
        updates: [{ key: item.key, childId: item.childId, fields: { campaignPublicId: Number(item.publicId) } }],
      }));
      const after = await this.snapshot(item.childId, campaignId);
      const rec = await this.audit.record(actor, {
        action: 'child.renumber', entity: 'Child', entityId: item.childId, source: SOURCE, ...ctx,
        summary: `Trocou o ID de ${before.child.name} nesta campanha: ${this.campaignPid(before)} → ${item.publicId}`,
        before, after,
      });
      return { childId: item.childId, auditId: rec?.id };
    }

    if (item.op === 'photo') {
      const before = (await this.snapshot(item.childId, campaignId))!;
      const file = await this.importPhoto(campaign, item.childId, item.photoFileId);
      const after = await this.snapshot(item.childId, campaignId);
      const rec = await this.audit.record(actor, {
        action: 'child.photo', entity: 'Child', entityId: item.childId, source: SOURCE, ...ctx,
        summary: `${before.images.length ? 'Trocou' : 'Colocou'} a foto de ${before.child.name} (ID ${this.campaignPid(before)}) pela do Drive (${file.name})`,
        before, after,
        meta: { photoFileId: item.photoFileId, driveName: file.name, driveMd5: file.md5 },
      });
      return { childId: item.childId, auditId: rec?.id };
    }

    // remove
    const before = (await this.snapshot(item.childId, campaignId))!;
    const decision = item.sponsorship ?? null;
    const active = plan.sponsorships?.find((s) => s.blocking) ?? null;
    let replacement: { id: string; name: string; publicId: number } | null = null;
    if (active && decision?.decision === 'replace') {
      replacement = await this.checkReplacement(campaignId, decision.replacementChildId, item.childId, new Set());
    }
    const stamp = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const pid = this.campaignPid(before);

    await this.prisma.$transaction(async (tx) => {
      if (active && decision) {
        // confere dentro da transação que nada mudou
        const cur = await tx.sponsorship.findUnique({ where: { id: active.id }, select: { status: true, childId: true, note: true } });
        if (!cur || cur.childId !== item.childId || cur.status !== active.status) throw new Error('O apadrinhamento mudou desde a conferência. Confira de novo.');
        const line = decision.decision === 'cancel'
          ? `[${stamp}] Cancelado: ${before.child.name} (ID ${pid}) saiu da planilha da campanha.`
          : `[${stamp}] Trocado: ${before.child.name} (ID ${pid}) saiu da planilha; passou para ${replacement!.name} (ID ${replacement!.publicId}).`;
        const note = [cur.note?.trim(), line].filter(Boolean).join('\n');
        if (decision.decision === 'cancel') {
          await tx.sponsorship.update({ where: { id: active.id }, data: { status: SponsorshipStatus.CANCELLED, note } });
        } else {
          await tx.sponsorship.update({ where: { id: active.id }, data: { childId: replacement!.id, note } });
        }
      }
      await tx.campaignChildInclude.deleteMany({ where: { campaignId, childId: item.childId } });
      await tx.childCampaignData.deleteMany({ where: { campaignId, childId: item.childId } });
      await tx.childImage.deleteMany({ where: { campaignId, childId: item.childId } });
    });

    const after = await this.snapshot(item.childId, campaignId);
    const sponsorText = active
      ? decision?.decision === 'cancel'
        ? `; apadrinhamento de ${active.sponsor.name} cancelado`
        : `; apadrinhamento de ${active.sponsor.name} passou para ${replacement!.name} (ID ${replacement!.publicId})`
      : '';
    const rec = await this.audit.record(actor, {
      action: 'child.remove', entity: 'Child', entityId: item.childId, source: SOURCE, ...ctx,
      summary: `Tirou ${before.child.name} (ID ${pid}) da campanha (saiu da planilha)${sponsorText}`,
      before, after,
      meta: active ? { sponsorshipId: active.id, decision: decision?.decision, sponsor: active.sponsor, replacement } : undefined,
    });
    if (active && rec) {
      await this.audit.record(actor, {
        action: decision?.decision === 'cancel' ? 'sponsorship.cancel' : 'sponsorship.replace',
        entity: 'Sponsorship', entityId: active.id, source: SOURCE, ...ctx,
        summary: decision?.decision === 'cancel'
          ? `Cancelou o apadrinhamento de ${active.sponsor.name} para ${before.child.name} (ID ${pid}): a criança saiu da planilha`
          : `Passou o apadrinhamento de ${active.sponsor.name} de ${before.child.name} (ID ${pid}) para ${replacement!.name} (ID ${replacement!.publicId})`,
        before: { childId: item.childId, status: active.status },
        after: decision?.decision === 'cancel' ? { childId: item.childId, status: 'CANCELLED' } : { childId: replacement!.id, status: active.status },
        meta: { partOf: rec.id, sponsor: active.sponsor },
      });
    }
    return { childId: item.childId, auditId: rec?.id };
  }

  /** Baixa a foto do Drive e publica nesta campanha (com o layout da cidade), como no envio manual */
  private async importPhoto(campaign: Awaited<ReturnType<SourceSyncService['campaign']>>, childId: string, fileId: string) {
    const file = await this.google.download(fileId);
    if (!/^image\/(jpeg|png|webp|avif)$/i.test(file.mime)) {
      throw new Error(`A foto "${file.name}" está em ${file.mime}; o site aceita JPG, PNG ou WEBP.`);
    }
    const child = await this.prisma.child.findUnique({ where: { id: childId }, select: { id: true, publicId: true, cityId: true } });
    if (!child) throw new Error('Criança não encontrada.');
    const city = child.cityId ? await this.prisma.city.findUnique({ where: { id: child.cityId }, select: { id: true, publicId: true } }) : null;
    const frame = await this.frames.resolveForChild(campaign.id, child.cityId);
    await this.keepPreviousFiles(child.id, campaign.id);
    const img = await this.childImages.createFromUpload({
      childId: child.id,
      childPublicId: child.publicId,
      campaign: {
        id: campaign.id,
        folder: String(campaign.publicId ?? campaign.id),
        frameKey: frame?.key ?? campaign.frameKey ?? null,
        frameUrl: frame?.url ?? campaign.frameUrl ?? null,
        frameConfig: frame?.config ?? campaign.frameConfig ?? null,
      },
      cityFolder: String(city?.publicId ?? city?.id ?? 'no-city'),
      file: { buffer: file.buffer, mime: file.mime.toLowerCase() },
      compose: (frame?.config as any) ?? undefined,
    });
    await this.prisma.child.update({ where: { id: child.id }, data: { photoUrl: img.framedUrl ?? img.processedUrl ?? img.originalUrl } });
    return file;
  }

  /**
   * A foto nova é gravada no mesmo caminho da anterior (pasta da criança na campanha). Antes de
   * trocar, copia os arquivos das fotos atuais para um nome próprio e aponta o registro para a
   * cópia — assim a foto anterior continua existindo e o "desfazer" a traz de volta de verdade.
   */
  private async keepPreviousFiles(childId: string, campaignId: string) {
    const rows = await this.prisma.childImage.findMany({
      where: { childId, campaignId },
      select: { id: true, originalKey: true, processedKey: true, framedKey: true },
    });
    for (const r of rows) {
      const data: Prisma.ChildImageUpdateInput = {};
      const copy = async (key: string | null) => {
        if (!key || key.includes('/bkp-') || !(await this.storage.exists(key))) return null;
        const slash = key.lastIndexOf('/');
        const target = `${key.slice(0, slash + 1)}bkp-${r.id}-${key.slice(slash + 1)}`;
        await this.storage.saveBuffer(target, await this.storage.readBufferByKey(key));
        return target;
      };
      const o = await copy(r.originalKey);
      if (o) { data.originalKey = o; data.originalUrl = this.storage.publicUrl(o); }
      const p = await copy(r.processedKey);
      if (p) { data.processedKey = p; data.processedUrl = this.storage.publicUrl(p); }
      const f = await copy(r.framedKey);
      if (f) { data.framedKey = f; data.framedUrl = this.storage.publicUrl(f); }
      if (Object.keys(data).length) await this.prisma.childImage.update({ where: { id: r.id }, data });
    }
  }

  /* ————————————————————— desfazer ————————————————————— */

  async undo(auditId: string, actor: AuditActor) {
    const entry = await this.prisma.auditLog.findUnique({ where: { id: auditId } });
    if (!entry) throw new NotFoundException('Registro não encontrado.');
    if (entry.source !== SOURCE || !UNDOABLE.includes(entry.action)) throw new BadRequestException('Este registro não pode ser desfeito por aqui.');
    if (entry.revertedAt) throw new BadRequestException('Este registro já foi desfeito.');
    if (!entry.campaignId || !entry.entityId) throw new BadRequestException('Registro incompleto.');
    const before = entry.before as unknown as Snapshot | null;
    const after = entry.after as unknown as Snapshot | null;
    if ((before as any)?.truncated || (after as any)?.truncated) throw new BadRequestException('A ficha guardada está incompleta; não dá para desfazer automaticamente.');

    const later = await this.prisma.auditLog.findFirst({
      where: { source: SOURCE, entityId: entry.entityId, campaignId: entry.campaignId, action: { in: UNDOABLE }, revertedAt: null, createdAt: { gt: entry.createdAt } },
      orderBy: { createdAt: 'desc' },
      select: { summary: true, createdAt: true },
    });
    if (later) {
      throw new BadRequestException(`Há uma alteração mais recente nesta criança ("${later.summary}"). Desfaça a mais recente primeiro.`);
    }

    const campaignId = entry.campaignId;
    const childId = entry.entityId;
    const current = await this.snapshot(childId, campaignId);

    await this.prisma.$transaction(async (tx) => {
      await this.restore(tx, campaignId, childId, before, (entry.meta as any)?.createdNew === true);
    }, { timeout: 60_000 });

    const restored = await this.snapshot(childId, campaignId);
    const rec = await this.audit.record(actor, {
      action: 'child.undo', entity: 'Child', entityId: childId, campaignId, batchId: entry.batchId, source: SOURCE,
      summary: `Desfez: ${entry.summary}`,
      before: current, after: restored,
      meta: { undoOf: entry.id },
    });
    const mark = { revertedAt: new Date(), revertedBy: rec?.id ?? null };
    await this.prisma.auditLog.update({ where: { id: entry.id }, data: mark });
    await this.prisma.auditLog.updateMany({ where: { meta: { path: ['partOf'], equals: entry.id } }, data: mark });
    return { ok: true, auditId: rec?.id ?? null };
  }

  async undoBatch(batchId: string, actor: AuditActor) {
    if (!batchId) throw new BadRequestException('Lote não informado.');
    const entries = await this.prisma.auditLog.findMany({
      where: { batchId, source: SOURCE, action: { in: UNDOABLE }, revertedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, summary: true },
    });
    const results: { id: string; summary: string; ok: boolean; message?: string }[] = [];
    for (const e of entries) {
      try {
        await this.undo(e.id, actor);
        results.push({ id: e.id, summary: e.summary, ok: true });
      } catch (err: any) {
        results.push({ id: e.id, summary: e.summary, ok: false, message: err?.message ?? 'Falha ao desfazer.' });
      }
    }
    return { undone: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), total: results.length };
  }

  /** Volta a criança, nesta campanha, para a ficha guardada (ou tira o cadastro novo) */
  private async restore(tx: Prisma.TransactionClient, campaignId: string, childId: string, before: Snapshot | null, createdNew: boolean) {
    if (!before) {
      const sp = await tx.sponsorship.count({ where: { campaignId, childId, status: { not: SponsorshipStatus.CANCELLED } } });
      if (sp) throw new BadRequestException('A criança já recebeu apadrinhamento nesta campanha; resolva o apadrinhamento antes de desfazer o cadastro.');
      await tx.campaignChildInclude.deleteMany({ where: { campaignId, childId } });
      await tx.childCampaignData.deleteMany({ where: { campaignId, childId } });
      await tx.childImage.deleteMany({ where: { campaignId, childId } });
      if (createdNew) {
        const elsewhere = await tx.child.count({
          where: { id: childId, OR: [{ images: { some: {} } }, { campaignIncludes: { some: {} } }, { sponsorships: { some: {} } }] },
        });
        if (!elsewhere) await tx.child.update({ where: { id: childId }, data: { deletedAt: new Date() } });
      }
      return;
    }

    const c = before.child;
    await tx.child.update({
      where: { id: childId },
      data: {
        name: c.name, birthDate: toDate(c.birthDate), age: c.age, motherName: c.motherName, wantedGift: c.wantedGift,
        cityId: c.cityId, cityName: c.cityName, communityId: c.communityId, schoolId: c.schoolId, photoUrl: c.photoUrl,
        deletedAt: toDate(c.deletedAt),
      },
    });

    if (before.include) {
      await tx.campaignChildInclude.createMany({ data: [{ campaignId, childId, sourceCampaignId: before.include.sourceCampaignId }], skipDuplicates: true });
    } else {
      await tx.campaignChildInclude.deleteMany({ where: { campaignId, childId } });
    }

    if (before.campaignData) {
      const pid = before.campaignData.publicId;
      if (pid != null) {
        const clash = await tx.childCampaignData.findFirst({ where: { campaignId, publicId: pid, childId: { not: childId } }, select: { child: { select: { name: true } } } });
        if (clash) throw new BadRequestException(`O ID ${pid} agora é de ${clash.child.name} nesta campanha; não dá para devolver.`);
      }
      await tx.childCampaignData.upsert({
        where: { childId_campaignId: { childId, campaignId } },
        create: { childId, campaignId, publicId: pid, wantedGift: before.campaignData.wantedGift },
        update: { publicId: pid, wantedGift: before.campaignData.wantedGift },
      });
    } else {
      await tx.childCampaignData.deleteMany({ where: { campaignId, childId } });
    }

    const current = await tx.childImage.findMany({ where: { campaignId, childId }, select: { id: true } });
    const keep = new Set(before.images.map((i) => String(i.id)));
    const extra = current.filter((i) => !keep.has(i.id)).map((i) => i.id);
    if (extra.length) await tx.childImage.deleteMany({ where: { id: { in: extra } } });
    const have = new Set(current.map((i) => i.id));
    for (const i of before.images) {
      if (have.has(String(i.id))) continue;
      await tx.childImage.create({
        data: {
          id: i.id, childId, campaignId,
          originalKey: i.originalKey, originalUrl: i.originalUrl,
          processedKey: i.processedKey ?? null, processedUrl: i.processedUrl ?? null,
          framedKey: i.framedKey ?? null, framedUrl: i.framedUrl ?? null,
          layoutKey: i.layoutKey ?? null, layoutUrl: i.layoutUrl ?? null,
          Config: i.Config ?? undefined,
          width: i.width ?? null, height: i.height ?? null,
          status: i.status, notes: i.notes ?? null, version: i.version ?? 1,
          createdAt: toDate(i.createdAt) ?? undefined,
        },
      });
    }

    for (const s of before.sponsorships) {
      const cur = await tx.sponsorship.findUnique({ where: { id: s.id }, select: { childId: true, status: true } });
      if (!cur || (cur.childId === s.childId && cur.status === s.status)) continue;
      if (cur.childId !== s.childId) {
        const taken = await tx.sponsorship.findFirst({ where: { campaignId, childId: s.childId, id: { not: s.id } }, select: { id: true } });
        if (taken) throw new BadRequestException('A criança já tem outro apadrinhamento nesta campanha; não dá para devolver o anterior.');
      }
      await tx.sponsorship.update({ where: { id: s.id }, data: { childId: s.childId, status: s.status, note: s.note } });
    }
  }
}
