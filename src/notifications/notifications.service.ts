import { Injectable, Logger } from '@nestjs/common';
import { Role, SponsorshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';

const STAFF_ROLES: Role[] = [Role.ADMIN, Role.STAFF];

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  private adminUrl(path = '') {
    const base = (process.env.ADMIN_URL || process.env.FRONTEND_ORIGIN?.split(',')[0] || '').trim().replace(/\/+$/, '');
    return base ? `${base}${path}` : '';
  }

  /* ===================== Preferências (por usuário admin/equipe) ===================== */

  async getPreferences(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, notifyPendingSponsorships: true },
    });
    return {
      email: user?.email ?? null,
      emailPendingSponsorships: !!user?.notifyPendingSponsorships,
      mailProblem: this.mail.problem,
    };
  }

  async setPreferences(userId: string, prefs: { emailPendingSponsorships?: boolean }) {
    if (typeof prefs.emailPendingSponsorships === 'boolean') {
      await this.prisma.user.update({
        where: { id: userId },
        data: { notifyPendingSponsorships: prefs.emailPendingSponsorships },
      });
    }
    return this.getPreferences(userId);
  }

  async sendTest(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user?.email) return { sent: false, reason: 'Usuário sem e-mail' };
    try {
      const sent = await this.mail.send({
        to: user.email,
        subject: 'Teste de notificação — Amigos de Minas',
        text: `Olá ${user.name}, as notificações por e-mail do painel estão funcionando.`,
        html: `<p>Olá ${esc(user.name)},</p><p>As notificações por e-mail do painel <b>Amigos de Minas</b> estão funcionando.</p>`,
      });
      return sent ? { sent: true, to: user.email } : { sent: false, reason: this.mail.problem };
    } catch (e: any) {
      return { sent: false, reason: e?.message ?? 'Falha ao enviar' };
    }
  }

  /* ===================== Sino do painel ===================== */

  /** Pendentes (na campanha, se informada) + os mais recentes, para o sino e alertas do navegador */
  async pendingSummary(campaignId?: string) {
    const where = { status: SponsorshipStatus.PENDING, ...(campaignId ? { campaignId } : {}) };
    const [count, latest] = await Promise.all([
      this.prisma.sponsorship.count({ where }),
      this.prisma.sponsorship.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          createdAt: true,
          method: true,
          campaignId: true,
          child: {
            select: {
              id: true,
              name: true,
              publicId: true,
              campaignData: { select: { campaignId: true, publicId: true } },
            },
          },
          sponsor: { select: { name: true } },
          campaign: { select: { name: true } },
        },
      }),
    ]);

    return {
      count,
      latest: latest.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        method: s.method,
        childId: s.child.id,
        childName: s.child.name,
        childPublicId: s.child.campaignData.find((d) => d.campaignId === s.campaignId)?.publicId ?? s.child.publicId,
        sponsorName: s.sponsor?.name ?? null,
        campaignName: s.campaign?.name ?? null,
      })),
    };
  }

  /* ===================== E-mail de novos pendentes ===================== */

  /** Chamado após criar apadrinhamentos: avisa por e-mail os admins que pediram. Nunca lança. */
  pendingCreated(sponsorshipIds: string[]) {
    if (!sponsorshipIds.length) return;
    this.sendPendingEmail(sponsorshipIds).catch((e) =>
      this.log.error(`Falha ao enviar aviso de apadrinhamento pendente: ${e?.message ?? e}`),
    );
  }

  private async sendPendingEmail(ids: string[]) {
    const admins = await this.prisma.user.findMany({
      where: { notifyPendingSponsorships: true, roles: { hasSome: STAFF_ROLES } },
      select: { email: true },
    });
    if (!admins.length) return;

    const rows = await this.prisma.sponsorship.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: {
        campaignId: true,
        method: true,
        donationAmount: true,
        child: {
          select: {
            name: true,
            publicId: true,
            cityName: true,
            community: { select: { name: true } },
            wantedGift: true,
            campaignData: { select: { campaignId: true, publicId: true, wantedGift: true } },
          },
        },
        sponsor: { select: { name: true, email: true, phone: true } },
        campaign: { select: { name: true } },
        collectionPoint: { select: { name: true } },
      },
    });
    if (!rows.length) return;

    const first = rows[0];
    const sponsor = first.sponsor;
    const items = rows.map((r) => {
      const data = r.child.campaignData.find((d) => d.campaignId === r.campaignId);
      return {
        id: data?.publicId ?? r.child.publicId,
        name: r.child.name,
        place: [r.child.community?.name, r.child.cityName].filter(Boolean).join(' — '),
        gift: data?.wantedGift ?? r.child.wantedGift ?? '',
      };
    });
    const method =
      first.method === 'PIX'
        ? `PIX${first.donationAmount != null ? ` (R$ ${Number(first.donationAmount).toFixed(2).replace('.', ',')})` : ''}`
        : `Presente${first.collectionPoint?.name ? ` — entrega em ${first.collectionPoint.name}` : ''}`;
    const link = this.adminUrl('/admin/sponsorships');

    const subject =
      rows.length === 1
        ? `Novo apadrinhamento pendente: ${items[0].name}`
        : `${rows.length} novos apadrinhamentos pendentes (${sponsor?.name ?? 'padrinho'})`;

    const text = [
      `${sponsor?.name ?? 'Um padrinho'} pediu para apadrinhar ${rows.length === 1 ? 'uma criança' : `${rows.length} crianças`} na campanha ${first.campaign?.name ?? ''}.`,
      '',
      ...items.map((i) => `• ${i.id} ${i.name}${i.place ? ` (${i.place})` : ''}${i.gift ? ` — ${i.gift}` : ''}`),
      '',
      `Forma: ${method}`,
      `Contato: ${[sponsor?.email, sponsor?.phone].filter(Boolean).join(' · ')}`,
      link ? `\nAprovar no painel: ${link}` : '',
    ].join('\n');

    const html = `
<div style="font-family:Arial,sans-serif;color:#111827;max-width:560px">
  <h2 style="margin:0 0 8px">Apadrinhamento aguardando aprovação</h2>
  <p style="margin:0 0 16px;color:#374151"><b>${esc(sponsor?.name ?? 'Um padrinho')}</b> pediu para apadrinhar
    ${rows.length === 1 ? 'uma criança' : `<b>${rows.length}</b> crianças`} na campanha <b>${esc(first.campaign?.name)}</b>.</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    ${items
      .map(
        (i) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;white-space:nowrap">#${esc(i.id)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb"><b>${esc(i.name)}</b>${i.place ? `<br><span style="color:#6b7280;font-size:12px">${esc(i.place)}</span>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;color:#374151">${esc(i.gift)}</td>
    </tr>`,
      )
      .join('')}
  </table>
  <p style="margin:16px 0 4px;font-size:14px"><b>Forma:</b> ${esc(method)}</p>
  <p style="margin:0 0 16px;font-size:14px"><b>Contato:</b> ${esc([sponsor?.email, sponsor?.phone].filter(Boolean).join(' · '))}</p>
  ${link ? `<a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold">Abrir apadrinhamentos</a>` : ''}
  <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">Você recebe este aviso porque ativou as notificações no painel. Para parar, desative no sino do painel administrativo.</p>
</div>`;

    // um e-mail por admin (não expõe os endereços uns dos outros)
    for (const a of admins) {
      try {
        const sent = await this.mail.send({ to: a.email, subject, text, html });
        if (!sent) return; // e-mail desativado: não adianta tentar os outros
      } catch (e: any) {
        this.log.error(`Falha ao enviar para ${a.email}: ${e?.message ?? e}`);
      }
    }
  }
}
