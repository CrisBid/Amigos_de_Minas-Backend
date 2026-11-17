import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';

/** Rota que grava o próprio histórico (com antes/depois) ou que só lê: o registro automático pula */
export const AUDIT_SKIP = 'audit:skip';
export const AuditSkip = () => SetMetadata(AUDIT_SKIP, true);

// POSTs que só leem/calculam, e as rotas de login (sem usuário identificado ou sem efeito para auditar)
const SKIP_PATHS = [
  /^\/auth\//,
  /^\/children\/bulk\/update\/(preview|photo-hashes)$/,
  /^\/sponsorships\/pdf-data$/,
  /^\/source-check\/(site-md5|plan)$/,
  /^\/notifications\/test$/,
];

const ENTITY_PT: Record<string, string> = {
  children: 'criança',
  sponsorships: 'apadrinhamento',
  campaigns: 'campanha',
  'campaign-frames': 'layout da campanha',
  communities: 'comunidade',
  cities: 'cidade',
  schools: 'escola',
  'collection-points': 'ponto de coleta',
  users: 'usuário',
  profiles: 'perfil',
  sponsors: 'padrinho',
  'child-images': 'foto',
  notifications: 'notificações',
  'source-check': 'conferência com a origem',
};

const ROUTE_PT: Record<string, string> = {
  'POST /children': 'Cadastrou criança',
  'PATCH /children/:id': 'Editou criança',
  'DELETE /children/:id': 'Excluiu criança',
  'POST /children/:id/photo': 'Enviou foto da criança',
  'DELETE /children/:id/photo': 'Removeu foto da criança',
  'PUT /children/:id/campaigns/:campaignId': 'Alterou ID/presente da criança na campanha',
  'POST /children/bulk/commit': 'Cadastro guiado por planilha',
  'POST /children/bulk/update/apply': 'Atualização de crianças por planilha',
  'POST /sponsorships': 'Criou apadrinhamento',
  'PATCH /sponsorships/:id': 'Editou apadrinhamento',
  'PATCH /sponsorships/:id/activate': 'Ativou apadrinhamento',
  'PATCH /sponsorships/:id/end': 'Encerrou apadrinhamento',
  'DELETE /sponsorships/:id': 'Excluiu apadrinhamento',
  'POST /sponsorships/transfer': 'Transferiu apadrinhamentos',
  'POST /sponsorships/bulk-delete': 'Excluiu apadrinhamentos em massa',
  'PUT /source-check/config': 'Alterou os links da origem (planilha/fotos)',
};

const VERB: Record<string, string> = { POST: 'Criou', PUT: 'Alterou', PATCH: 'Alterou', DELETE: 'Excluiu' };

/**
 * Registra no histórico toda gravação (POST/PUT/PATCH/DELETE) feita por usuário identificado:
 * quem, quando, a rota, o item e os dados enviados (sem senhas). Só depois de dar certo.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private audit: AuditService, private reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const method = String(req.method ?? '').toUpperCase();
    if (!VERB[method]) return next.handle();
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    if (SKIP_PATHS.some((re) => re.test(path))) return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(AUDIT_SKIP, [ctx.getHandler(), ctx.getClass()])) return next.handle();

    return next.handle().pipe(
      tap(() => {
        if (!req.user) return;
        const res = ctx.switchToHttp().getResponse();
        void this.write(req, method, path, res?.statusCode);
      }),
    );
  }

  private async write(req: any, method: string, path: string, status?: number) {
    const route = String(req.route?.path ?? path); // ex.: /children/:id
    const key = `${method} ${route}`;
    const segments = route.split('/').filter(Boolean);
    const entity = segments[0] ?? null;
    const params = (req.params ?? {}) as Record<string, string>;
    const entityId = params.id ?? null;
    const body = req.body && typeof req.body === 'object' ? req.body : undefined;
    const campaignId =
      (typeof body?.campaignId === 'string' && body.campaignId) ||
      (typeof body?.context?.campaignId === 'string' && body.context.campaignId) ||
      (typeof req.query?.campaignId === 'string' && req.query.campaignId) ||
      params.campaignId ||
      null;
    const summary = ROUTE_PT[key] ?? `${VERB[method]} ${entity ? ENTITY_PT[entity] ?? entity : 'item'} (${key})`;
    const file = req.file ? { name: req.file.originalname, type: req.file.mimetype, size: req.file.size } : undefined;

    await this.audit.record(req.user, {
      action: key,
      summary,
      entity,
      entityId,
      campaignId,
      source: 'api',
      after: body && Object.keys(body).length ? body : undefined,
      meta: { path, query: req.query, params, status, ...(file ? { file } : {}) },
    });
  }
}
