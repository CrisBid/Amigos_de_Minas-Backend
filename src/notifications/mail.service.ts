import { Injectable, Logger } from '@nestjs/common';

/**
 * Envio de e-mail por SMTP (nodemailer). Fica desligado — sem erro — enquanto
 * SMTP_HOST não estiver configurado ou o pacote `nodemailer` não estiver instalado.
 *
 * Variáveis: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE (true p/ 465), MAIL_FROM.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private transporter: any | null | undefined;

  /** Motivo de o e-mail não funcionar (null = pronto para enviar) */
  get problem(): string | null {
    if (!process.env.SMTP_HOST) return 'SMTP_HOST não configurado no servidor';
    try {
      require.resolve('nodemailer');
    } catch {
      return 'pacote nodemailer não instalado no servidor';
    }
    return null;
  }

  private getTransporter() {
    if (this.transporter !== undefined) return this.transporter;
    const problem = this.problem;
    if (problem) {
      this.log.warn(`E-mail desativado: ${problem}`);
      return (this.transporter = null);
    }
    const port = Number(process.env.SMTP_PORT || 587);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer');
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return this.transporter;
  }

  /** true = enviado; false = e-mail desativado */
  async send(msg: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
    const t = this.getTransporter();
    if (!t) return false;
    await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...msg });
    return true;
  }
}
