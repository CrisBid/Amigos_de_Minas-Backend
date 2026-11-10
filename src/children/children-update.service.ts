import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

/* Atualização de crianças por planilha: a prévia diz, linha a linha, se a criança já existe
   (e devolve a ficha atual dela para a tela comparar) ou se seria cadastrada; a aplicação grava
   só os campos escolhidos na tela — campo vazio na planilha nunca apaga o que já existe. */

export type UpdateContext = { campaignId: string; cityId: string; communityId?: string | null; schoolId?: string | null };

export type IncomingRow = {
  key: string;
  publicId: string | number;
  name: string;
  birthDate?: string | null; // yyyy-mm-dd
  age?: number | null;
  motherName?: string | null;
  category?: string | null;
  wantedGift?: string | null;
  description?: string | null;
};

/** Campos que a tela pode escolher atualizar */
export type UpdateFields = {
  name?: string;
  birthDate?: string;
  age?: number;
  motherName?: string;
  category?: string;
  description?: string;
  wantedGift?: string;
  /** ID da criança nesta campanha */
  campaignPublicId?: number;
  /** move para a comunidade/escola escolhidas na tela */
  location?: boolean;
};

export type UpdateItem = { key: string; childId: string; fields: UpdateFields };

type MatchedBy = 'campaignId' | 'mainId' | 'name' | 'manual';

const normalize = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Mesmo primeiro nome e o resto quase igual ("KAIKI LOPES ROCHA" × "KAYKY LOPES ROCHA", nome com/sem sobrenome do meio) */
function similarName(a: string, b: string) {
  const A = normalize(a).split(' ').filter((w) => w.length > 2);
  const B = normalize(b).split(' ').filter((w) => w.length > 2);
  if (!A.length || !B.length) return false;
  if (editDistance(A[0], B[0]) > 2) return false;
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  const hits = short.filter((w) => long.some((x) => x === w || (w.length > 4 && editDistance(w, x) <= 2))).length;
  return hits >= Math.max(2, short.length - 1);
}

const childSelect = (campaignId: string) =>
  ({
    id: true,
    publicId: true,
    name: true,
    birthDate: true,
    age: true,
    motherName: true,
    category: true,
    wantedGift: true,
    description: true,
    cityId: true,
    cityName: true,
    communityId: true,
    schoolId: true,
    community: { select: { name: true } },
    school: { select: { name: true } },
    campaignData: { where: { campaignId }, select: { publicId: true, wantedGift: true } },
    campaignIncludes: { where: { campaignId }, select: { id: true } },
    images: { where: { campaignId }, select: { id: true }, take: 1 },
  }) satisfies Prisma.ChildSelect;

type ChildRow = Prisma.ChildGetPayload<{ select: ReturnType<typeof childSelect> }>;

/** Ficha atual, no formato que a tela compara com a planilha */
function snapshot(c: ChildRow) {
  const data = c.campaignData[0];
  return {
    id: c.id,
    publicId: c.publicId,
    campaignPublicId: data?.publicId ?? null,
    name: c.name,
    birthDate: c.birthDate ? c.birthDate.toISOString().slice(0, 10) : null,
    age: c.age,
    motherName: c.motherName,
    category: c.category,
    // presente desta campanha; sem registro nela, o do cadastro (que pode ser de outra campanha)
    wantedGift: data ? data.wantedGift : c.wantedGift,
    giftFromCampaign: !!data,
    description: c.description,
    cityId: c.cityId,
    cityName: c.cityName,
    communityId: c.communityId,
    communityName: c.community?.name ?? null,
    schoolId: c.schoolId,
    schoolName: c.school?.name ?? null,
    inCampaign: c.campaignIncludes.length > 0 || c.images.length > 0,
    hasPhoto: c.images.length > 0,
  };
}

@Injectable()
export class ChildrenUpdateService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /**
   * Impressão digital (SHA-256) da foto atual de cada criança: a desta campanha e a mais recente
   * de outra campanha. A tela compara com o arquivo escolhido para não reenviar a mesma foto.
   */
  async photoHashes(campaignId: string, childIdsRaw: string[]) {
    if (!campaignId) throw new BadRequestException('Escolha a campanha.');
    const childIds = [...new Set((childIdsRaw ?? []).filter((id) => typeof id === 'string'))].slice(0, 1000);
    const images = await this.prisma.childImage.findMany({
      where: { childId: { in: childIds } },
      orderBy: { createdAt: 'desc' },
      select: { childId: true, campaignId: true, originalKey: true, createdAt: true, campaign: { select: { name: true } } },
    });

    type Pick = { key: string; createdAt: Date; campaignName: string | null };
    const latest = new Map<string, { current?: Pick; other?: Pick }>();
    for (const img of images) {
      const slot = latest.get(img.childId) ?? {};
      const pick = { key: img.originalKey, createdAt: img.createdAt, campaignName: img.campaign?.name ?? null };
      if (img.campaignId === campaignId) slot.current ??= pick;
      else slot.other ??= pick;
      latest.set(img.childId, slot);
    }

    const out: Record<string, { current: { hash: string; createdAt: Date } | null; other: { hash: string; campaignName: string | null } | null }> = {};
    const entries = [...latest.entries()];
    // lê do disco em paralelo, de poucos em poucos
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(entries.slice(i, i + 8).map(async ([childId, slot]) => {
        const [cur, oth] = await Promise.all([
          slot.current ? this.storage.hashByKey(slot.current.key) : null,
          slot.other ? this.storage.hashByKey(slot.other.key) : null,
        ]);
        out[childId] = {
          current: cur && slot.current ? { hash: cur, createdAt: slot.current.createdAt } : null,
          other: oth && slot.other ? { hash: oth, campaignName: slot.other.campaignName } : null,
        };
      }));
    }
    return { hashes: out };
  }

  private async checkContext(ctx: UpdateContext) {
    if (!ctx?.campaignId) throw new BadRequestException('Escolha a campanha.');
    if (!ctx?.cityId) throw new BadRequestException('Escolha a cidade.');
    const [campaign, city] = await Promise.all([
      this.prisma.campaign.findUnique({ where: { id: ctx.campaignId }, select: { id: true } }),
      this.prisma.city.findUnique({ where: { id: ctx.cityId }, select: { id: true, name: true } }),
    ]);
    if (!campaign) throw new BadRequestException('Campanha não encontrada.');
    if (!city) throw new BadRequestException('Cidade não encontrada.');
    return city;
  }

  /**
   * Para cada linha: a criança que já existe (pelo ID desta campanha; pelo ID principal com o
   * mesmo nome; ou pelo nome igual na cidade) ou "nova", com as parecidas da cidade como sugestão.
   */
  async preview(rowsRaw: IncomingRow[], ctx: UpdateContext) {
    await this.checkContext(ctx);
    const rows = (rowsRaw ?? []).filter((r) => r && String(r.name ?? '').trim());
    const select = childSelect(ctx.campaignId);
    const pids = [...new Set(rows.map((r) => parseInt(String(r.publicId), 10)).filter(Number.isFinite))];

    const [byCampaignId, byMainId, inCity] = await Promise.all([
      this.prisma.childCampaignData.findMany({
        where: { campaignId: ctx.campaignId, publicId: { in: pids }, child: { deletedAt: null } },
        select: { publicId: true, child: { select } },
      }),
      this.prisma.child.findMany({ where: { publicId: { in: pids }, deletedAt: null }, select }),
      this.prisma.child.findMany({ where: { cityId: ctx.cityId, deletedAt: null }, select }),
    ]);
    const campaignMap = new Map(byCampaignId.map((d) => [d.publicId!, d.child]));
    const mainMap = new Map(byMainId.map((c) => [c.publicId, c]));
    const byName = new Map<string, ChildRow[]>();
    for (const c of inCity) {
      const k = normalize(c.name);
      byName.set(k, [...(byName.get(k) ?? []), c]);
    }

    const usedBy = new Map<string, string>(); // childId -> key da primeira linha que a usou
    const out = rows.map((r) => {
      const pid = parseInt(String(r.publicId), 10);
      const warnings: string[] = [];
      let child: ChildRow | null = null;
      let matchedBy: MatchedBy | null = null;

      const inCampaign = Number.isFinite(pid) ? campaignMap.get(pid) : undefined;
      if (inCampaign) {
        child = inCampaign;
        matchedBy = 'campaignId';
        if (normalize(child.name) !== normalize(r.name) && !similarName(child.name, r.name)) {
          warnings.push(`O ID ${pid} nesta campanha é de "${child.name}", que tem outro nome. Confira se é a mesma criança.`);
        }
      }
      if (!child && Number.isFinite(pid)) {
        const main = mainMap.get(pid);
        // o ID principal só vale se for a mesma criança e ela não tiver outro número nesta campanha
        if (main && normalize(main.name) === normalize(r.name) && main.campaignData[0]?.publicId == null) {
          child = main;
          matchedBy = 'mainId';
        }
      }
      if (!child) {
        const same = (byName.get(normalize(r.name)) ?? []).filter((c) => c.campaignData[0]?.publicId == null || c.campaignData[0].publicId === pid);
        if (same.length === 1) {
          child = same[0];
          matchedBy = 'name';
        } else if (same.length > 1) {
          warnings.push(`Há ${same.length} crianças com este nome na cidade: escolha qual é ou cadastre como nova.`);
        }
      }

      if (child) {
        const first = usedBy.get(child.id);
        if (first) warnings.push(`Esta criança também está na linha ${first} da planilha.`);
        else usedBy.set(child.id, r.key);
      }

      // sugestões para quem ficou como nova: nomes parecidos na cidade
      const candidates = child
        ? []
        : inCity.filter((c) => similarName(c.name, r.name) || normalize(c.name) === normalize(r.name)).slice(0, 5).map(snapshot);

      return {
        key: r.key,
        action: child ? ('update' as const) : ('create' as const),
        matchedBy,
        child: child ? snapshot(child) : null,
        candidates,
        warnings,
      };
    });

    return { rows: out };
  }

  /** Grava as atualizações (só os campos enviados) e os cadastros novos. Cada linha é independente. */
  async apply(body: { context: UpdateContext; updates?: UpdateItem[]; creates?: IncomingRow[] }) {
    const ctx = body?.context;
    const city = await this.checkContext(ctx);
    const campaignId = ctx.campaignId;
    if (ctx.communityId) {
      const ok = await this.prisma.community.count({ where: { id: ctx.communityId, cityId: ctx.cityId } });
      if (!ok) throw new BadRequestException('Comunidade não encontrada nesta cidade.');
    }
    if (ctx.schoolId) {
      const ok = await this.prisma.school.count({ where: { id: ctx.schoolId, cityId: ctx.cityId } });
      if (!ok) throw new BadRequestException('Escola não encontrada nesta cidade.');
    }

    const ids: Record<string, string> = {};
    const updated: string[] = [];
    const created: string[] = [];
    const errors: { key: string; message: string }[] = [];

    for (const item of body.updates ?? []) {
      try {
        await this.applyUpdate(item, ctx, city);
        ids[item.key] = item.childId;
        updated.push(item.key);
      } catch (e: any) {
        errors.push({ key: item.key, message: e?.message ?? 'Falha ao atualizar.' });
      }
    }

    for (const row of body.creates ?? []) {
      try {
        ids[row.key] = await this.applyCreate(row, ctx, city);
        created.push(row.key);
      } catch (e: any) {
        errors.push({ key: row.key, message: e?.message ?? 'Falha ao cadastrar.' });
      }
    }

    return { updated, created, ids, errors };
  }

  private async assertCampaignIdFree(campaignId: string, publicId: number, childId?: string) {
    const taken = await this.prisma.childCampaignData.findFirst({
      where: { campaignId, publicId, ...(childId ? { childId: { not: childId } } : {}) },
      select: { child: { select: { name: true } } },
    });
    if (taken) throw new Error(`O ID ${publicId} já é de ${taken.child.name} nesta campanha.`);
  }

  private async applyUpdate(item: UpdateItem, ctx: UpdateContext, city: { id: string; name: string }) {
    const f = item.fields ?? {};
    const child = await this.prisma.child.findFirst({
      where: { id: item.childId, deletedAt: null },
      select: { id: true, wantedGift: true },
    });
    if (!child) throw new Error('Criança não encontrada.');

    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const data: Prisma.ChildUpdateInput = {};
    if (text(f.name)) data.name = text(f.name);
    if (text(f.motherName)) data.motherName = text(f.motherName);
    if (text(f.category)) data.category = text(f.category);
    if (text(f.description)) data.description = text(f.description);
    if (typeof f.age === 'number' && f.age >= 0) data.age = f.age;
    if (text(f.birthDate)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate!)) throw new Error('Data de nascimento inválida.');
      data.birthDate = new Date(`${f.birthDate}T00:00:00.000Z`);
    }
    if (f.location) {
      data.city = { connect: { id: city.id } };
      data.cityName = city.name;
      if (ctx.communityId) data.community = { connect: { id: ctx.communityId } };
      if (ctx.schoolId) data.school = { connect: { id: ctx.schoolId } };
    }
    const gift = text(f.wantedGift);
    const campaignPid = typeof f.campaignPublicId === 'number' && Number.isFinite(f.campaignPublicId) ? f.campaignPublicId : undefined;
    if (campaignPid !== undefined) await this.assertCampaignIdFree(ctx.campaignId, campaignPid, child.id);

    await this.prisma.$transaction(async (tx) => {
      if (gift) {
        // guarda o presente atual na campanha anterior antes de trocar (senão o histórico mostraria o novo)
        await this.keepPreviousGift(tx, child.id, child.wantedGift, ctx.campaignId);
        data.wantedGift = gift;
      }
      if (Object.keys(data).length) await tx.child.update({ where: { id: child.id }, data });

      // faz parte da campanha, com o ID e o presente dela
      await tx.campaignChildInclude.createMany({ data: [{ campaignId: ctx.campaignId, childId: child.id }], skipDuplicates: true });
      const campaignData = { ...(campaignPid !== undefined ? { publicId: campaignPid } : {}), ...(gift ? { wantedGift: gift } : {}) };
      await tx.childCampaignData.upsert({
        where: { childId_campaignId: { childId: child.id, campaignId: ctx.campaignId } },
        create: { childId: child.id, campaignId: ctx.campaignId, ...campaignData },
        update: campaignData,
      });
    });
  }

  /**
   * O presente atual fica no cadastro da criança; o de cada campanha, em ChildCampaignData.
   * Se a campanha mais recente em que ela esteve (fora esta) não tem o presente registrado,
   * registra lá o atual antes de ele ser trocado.
   */
  private async keepPreviousGift(tx: Prisma.TransactionClient, childId: string, currentGift: string | null, campaignId: string) {
    if (!currentGift?.trim()) return;
    const previous = await tx.campaign.findFirst({
      where: {
        id: { not: campaignId },
        OR: [{ images: { some: { childId } } }, { includedChildren: { some: { childId } } }],
      },
      orderBy: [{ year: 'desc' }, { startDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, childData: { where: { childId }, select: { id: true, wantedGift: true } } },
    });
    if (!previous) return;
    const row = previous.childData[0];
    if (!row) {
      await tx.childCampaignData.create({ data: { childId, campaignId: previous.id, wantedGift: currentGift.trim() } });
    } else if (!row.wantedGift) {
      await tx.childCampaignData.update({ where: { id: row.id }, data: { wantedGift: currentGift.trim() } });
    }
  }

  private async applyCreate(r: IncomingRow, ctx: UpdateContext, city: { id: string; name: string }) {
    const name = String(r.name ?? '').trim();
    if (name.length < 2) throw new Error('Nome ausente.');
    const pid = parseInt(String(r.publicId), 10);
    if (!Number.isFinite(pid)) throw new Error('ID inválido.');
    await this.assertCampaignIdFree(ctx.campaignId, pid);

    // ID principal: o da planilha se estiver livre no cadastro, senão o próximo livre
    const takenMain = await this.prisma.child.findUnique({ where: { publicId: pid }, select: { id: true } });
    const mainId = takenMain
      ? ((await this.prisma.child.aggregate({ _max: { publicId: true } }))._max.publicId ?? 0) + 1
      : pid;
    const gift = r.wantedGift?.trim() || null;
    const birth = r.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(r.birthDate) ? new Date(`${r.birthDate}T00:00:00.000Z`) : null;

    const child = await this.prisma.child.create({
      data: {
        publicId: mainId,
        name,
        birthDate: birth,
        age: typeof r.age === 'number' ? r.age : null,
        motherName: r.motherName?.trim() || null,
        category: r.category?.trim() || null,
        wantedGift: gift,
        description: r.description?.trim() || null,
        cityId: city.id,
        cityName: city.name,
        communityId: ctx.communityId || null,
        schoolId: ctx.schoolId || null,
        campaignIncludes: { create: { campaignId: ctx.campaignId } },
        campaignData: { create: { campaignId: ctx.campaignId, publicId: pid, wantedGift: gift } },
      },
      select: { id: true },
    });
    return child.id;
  }
}
