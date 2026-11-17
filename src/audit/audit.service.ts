import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Quem fez (o usuário do token: { sub, email, roles }) */
export type AuditActor = { sub?: string; email?: string } | null | undefined;

export type AuditEntry = {
  action: string;
  summary: string;
  entity?: string | null;
  entityId?: string | null;
  campaignId?: string | null;
  batchId?: string | null;
  source?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
};

export type AuditQuery = {
  skip?: number;
  take?: number;
  q?: string;
  entity?: string;
  entityId?: string;
  action?: string;
  actorId?: string;
  campaignId?: string;
  batchId?: string;
  source?: string;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd (inclusive)
};

const SECRET_KEY = /pass|senha|token|secret|hash|authorization/i;
// a ficha de antes/depois precisa caber inteira (é com ela que se desfaz)
const MAX_JSON = 100_000;

/** Tira senhas/tokens e corta textos muito grandes antes de guardar */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 8) return value ?? null;
  if (Array.isArray(value)) {
    const list = value.slice(0, 500).map((v) => redact(v, depth + 1));
    return value.length > 500 ? [...list, `… mais ${value.length - 500} item(ns)`] : list;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '***' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  if (typeof value === 'bigint') return String(value);
  return value;
}

/** Valor seguro para coluna Json (null vira DbNull; grande demais vira prévia em texto) */
function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  const clean = redact(value);
  const text = JSON.stringify(clean);
  if (text.length > MAX_JSON) return { truncated: true, preview: text.slice(0, MAX_JSON) };
  return JSON.parse(text);
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);
  private names = new Map<string, { name: string | null; email: string | null }>();

  constructor(private prisma: PrismaService) {}

  private async who(actor: AuditActor) {
    const id = actor?.sub ? String(actor.sub) : null;
    if (!id) return { actorId: null, actorName: null, actorEmail: actor?.email ?? null };
    let known = this.names.get(id);
    if (!known) {
      const u = await this.prisma.user.findUnique({ where: { id }, select: { name: true, email: true } }).catch(() => null);
      known = { name: u?.name ?? null, email: u?.email ?? actor?.email ?? null };
      this.names.set(id, known);
    }
    return { actorId: id, actorName: known.name, actorEmail: known.email };
  }

  /** Grava um registro. Nunca derruba a operação: se falhar, só avisa no log. */
  async record(actor: AuditActor, e: AuditEntry, tx?: Prisma.TransactionClient) {
    try {
      const data: Prisma.AuditLogUncheckedCreateInput = {
        ...(await this.who(actor)),
        action: e.action,
        summary: e.summary.slice(0, 1000),
        entity: e.entity ?? null,
        entityId: e.entityId ?? null,
        campaignId: e.campaignId ?? null,
        batchId: e.batchId ?? null,
        source: e.source ?? null,
        before: json(e.before),
        after: json(e.after),
        meta: json(e.meta),
      };
      return await (tx ?? this.prisma).auditLog.create({ data, select: { id: true } });
    } catch (err: any) {
      this.log.error(`Falha ao gravar o histórico (${e.action}): ${err?.message ?? err}`);
      return null;
    }
  }

  private where(q: AuditQuery): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];
    if (q.entity) and.push({ entity: q.entity });
    if (q.entityId) and.push({ entityId: q.entityId });
    if (q.action) and.push({ action: q.action });
    if (q.actorId) and.push({ actorId: q.actorId });
    if (q.campaignId) and.push({ campaignId: q.campaignId });
    if (q.batchId) and.push({ batchId: q.batchId });
    if (q.source) and.push({ source: q.source });
    const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00-03:00`) : null);
    const from = day(q.from);
    const to = day(q.to);
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lt: new Date(to.getTime() + 86_400_000) } });
    const text = (q.q ?? '').trim();
    if (text) {
      and.push({
        OR: [
          { summary: { contains: text, mode: 'insensitive' } },
          { actorName: { contains: text, mode: 'insensitive' } },
          { actorEmail: { contains: text, mode: 'insensitive' } },
          { entityId: text },
          { batchId: text },
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  async list(q: AuditQuery) {
    const take = Math.min(Math.max(1, q.take ?? 50), 200);
    const skip = Math.max(0, q.skip ?? 0);
    const where = this.where(q);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, skip, take, hasMore: skip + items.length < total };
  }

  /** Opções dos filtros: quem já alterou algo, ações e tipos de item */
  async facets() {
    const [actors, actions, entities] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['actorId', 'actorName', 'actorEmail'], where: { actorId: { not: null } }, _count: { _all: true } }),
      this.prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true } }),
      this.prisma.auditLog.groupBy({ by: ['entity'], where: { entity: { not: null } }, _count: { _all: true } }),
    ]);
    return {
      actors: actors
        .map((a) => ({ id: a.actorId!, name: a.actorName, email: a.actorEmail, count: a._count._all }))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR')),
      actions: actions.map((a) => ({ action: a.action, count: a._count._all })).sort((a, b) => a.action.localeCompare(b.action)),
      entities: entities.map((e) => ({ entity: e.entity!, count: e._count._all })).sort((a, b) => a.entity.localeCompare(b.entity)),
    };
  }

  /** Lotes (cada "aplicar" da conferência), do mais recente para o mais antigo */
  async batches(campaignId?: string, take = 20) {
    const rows = await this.prisma.auditLog.groupBy({
      by: ['batchId'],
      where: { batchId: { not: null }, ...(campaignId ? { campaignId } : {}) },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: Math.min(Math.max(1, take), 100),
    });
    const ids = rows.map((r) => r.batchId!) as string[];
    const detail = ids.length
      ? await this.prisma.auditLog.findMany({
          where: { batchId: { in: ids } },
          select: { batchId: true, action: true, actorName: true, actorEmail: true, revertedAt: true },
        })
      : [];
    return rows.map((r) => {
      const mine = detail.filter((d) => d.batchId === r.batchId);
      const byAction: Record<string, number> = {};
      for (const d of mine) byAction[d.action] = (byAction[d.action] ?? 0) + 1;
      return {
        batchId: r.batchId!,
        count: r._count._all,
        startedAt: r._min.createdAt,
        finishedAt: r._max.createdAt,
        actorName: mine[0]?.actorName ?? mine[0]?.actorEmail ?? null,
        byAction,
        reverted: mine.filter((d) => d.revertedAt).length,
      };
    });
  }
}
