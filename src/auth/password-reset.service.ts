import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';

const TOKEN_TTL_MIN = 60;          // validade do link
const MAX_REQUESTS_PER_HOUR = 3;   // por usuário, contra abuso

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * "Esqueci minha senha": envia por e-mail um link com token de uso único (só o hash fica no banco)
 * e troca a senha quando o link é usado. A resposta do pedido é sempre a mesma, exista ou não
 * a conta, para não revelar quais e-mails estão cadastrados.
 */
@Injectable()
export class PasswordResetService {
  private readonly log = new Logger(PasswordResetService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  private siteUrl() {
    const base = process.env.FRONTEND_URL || process.env.ADMIN_URL || process.env.FRONTEND_ORIGIN?.split(',')[0] || '';
    return base.trim().replace(/\/+$/, '');
  }

  async request(emailRaw: string) {
    const generic = { ok: true, message: 'Se o e-mail estiver cadastrado, enviaremos um link para criar uma nova senha.' };
    if (this.mail.problem) {
      this.log.error(`Recuperação de senha sem e-mail: ${this.mail.problem}`);
      throw new ServiceUnavailableException('O envio de e-mails está indisponível no momento. Tente mais tarde.');
    }

    const email = String(emailRaw ?? '').trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, name: true, email: true },
    });
    if (!user) return generic;

    const recent = await this.prisma.passwordReset.count({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 36e5) } },
    });
    if (recent >= MAX_REQUESTS_PER_HOUR) return generic;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 6e4);
    // um link válido por vez: os anteriores deixam de valer
    await this.prisma.$transaction([
      this.prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } }),
    ]);

    const link = `${this.siteUrl()}/reset-password?token=${token}`;
    const first = (user.name || '').split(' ')[0] || 'olá';
    try {
      await this.mail.send({
        to: user.email,
        subject: 'Redefinição de senha — Amigos de Minas',
        text: [
          `Olá, ${first}!`,
          '',
          'Recebemos um pedido para redefinir a senha da sua conta no Amigos de Minas.',
          `Para criar uma nova senha, acesse (válido por ${TOKEN_TTL_MIN} minutos):`,
          link,
          '',
          'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
        ].join('\n'),
        html: `
<div style="font-family:Arial,sans-serif;color:#111827;max-width:520px;margin:0 auto">
  <h2 style="margin:0 0 12px">Redefinição de senha</h2>
  <p style="margin:0 0 12px">Olá, ${esc(first)}!</p>
  <p style="margin:0 0 20px;color:#374151">Recebemos um pedido para redefinir a senha da sua conta no <b>Amigos de Minas</b>.</p>
  <p style="margin:0 0 24px">
    <a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">Criar nova senha</a>
  </p>
  <p style="margin:0 0 8px;font-size:13px;color:#6b7280">O link vale por ${TOKEN_TTL_MIN} minutos e só pode ser usado uma vez. Se o botão não funcionar, copie e cole no navegador:</p>
  <p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:#2563eb">${esc(link)}</p>
  <p style="margin:0;font-size:12px;color:#9ca3af">Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p>
</div>`,
      });
    } catch (e: any) {
      this.log.error(`Falha ao enviar e-mail de recuperação para ${user.email}: ${e?.message ?? e}`);
      throw new ServiceUnavailableException('Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.');
    }
    return generic;
  }

  private async findValid(token: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) return null;
    return row;
  }

  async validate(token: string) {
    return { valid: !!(await this.findValid(token)) };
  }

  async reset(token: string, password: string) {
    const row = await this.findValid(token);
    if (!row) throw new BadRequestException('Este link é inválido ou expirou. Peça um novo em "Esqueci minha senha".');

    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction([
      // senha nova + encerra as sessões abertas (o refresh antigo deixa de valer)
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash, refreshHash: null } }),
      this.prisma.passwordReset.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } }),
    ]);
    return { ok: true };
  }
}
