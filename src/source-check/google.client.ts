import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createSign } from 'crypto';

/* Acesso de leitura ao Google (Planilhas e Drive) com uma conta de serviço, sem biblioteca extra:
   assina o JWT com a chave privada e troca por um token de acesso.

   Variáveis (uma das duas formas):
   - GOOGLE_SERVICE_ACCOUNT_JSON = conteúdo do .json da conta de serviço (texto ou base64)
   - GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (com \n escapados)
   A planilha e a pasta precisam estar compartilhadas com o e-mail da conta (leitor). */

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FOLDER = 'application/vnd.google-apps.folder';

export type DriveFile = {
  id: string;
  name: string;
  /** pastas acima do arquivo, a partir da pasta da campanha (ex.: ["Bonito", "Almescla"]) */
  path: string[];
  mimeType: string;
  md5: string | null;
  size: number | null;
  modifiedTime: string;
};

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Aceita o link ou só o ID (de planilha ou de pasta) */
export function googleIdFromUrl(raw?: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const m = v.match(/\/(?:d|folders)\/([a-zA-Z0-9_-]{10,})/) ?? v.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{10,}$/.test(v) ? v : null;
}

@Injectable()
export class GoogleClient {
  private readonly log = new Logger(GoogleClient.name);
  private token: { value: string; exp: number } | null = null;

  private credentials(): { email: string; key: string } | null {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
      try {
        const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
        if (json.client_email && json.private_key) return { email: json.client_email, key: json.private_key };
      } catch {
        this.log.error('GOOGLE_SERVICE_ACCOUNT_JSON inválido');
      }
    }
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
    return email && key ? { email, key } : null;
  }

  /** E-mail da conta de serviço (para mostrar com quem compartilhar) ou null se não configurada */
  get serviceAccountEmail(): string | null {
    return this.credentials()?.email ?? null;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const cred = this.credentials();
    if (!cred) throw new ServiceUnavailableException('A conta de serviço do Google não está configurada no servidor.');

    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = b64url(JSON.stringify({ iss: cred.email, scope: SCOPES, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
    const signature = b64url(createSign('RSA-SHA256').update(`${header}.${claim}`).sign(cred.key));

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${signature}` }),
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j?.access_token) {
      this.log.error(`Login no Google falhou: ${res.status} ${JSON.stringify(j)}`);
      throw new ServiceUnavailableException('Não foi possível entrar no Google com a conta de serviço. Confira a chave configurada no servidor.');
    }
    this.token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async get(url: string, what: string) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = j?.error?.message ?? res.statusText;
      if (res.status === 403 || res.status === 404) {
        throw new ServiceUnavailableException(
          `Sem acesso ${what}. Compartilhe com ${this.serviceAccountEmail} como leitor e confira o link. (${msg})`,
        );
      }
      throw new ServiceUnavailableException(`Erro do Google ao ler ${what}: ${msg}`);
    }
    return j;
  }

  /** Todas as abas da planilha, com o texto de cada célula como aparece na tela */
  async readSpreadsheet(spreadsheetId: string) {
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
    const meta = await this.get(`${base}?fields=properties.title,sheets.properties(title,hidden)`, 'à planilha');
    const titles: string[] = (meta.sheets ?? []).filter((s: any) => !s.properties?.hidden).map((s: any) => s.properties.title);
    if (!titles.length) return { title: meta.properties?.title ?? '', tabs: [] };
    const qs = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS' });
    titles.forEach((t) => qs.append('ranges', `'${t.replace(/'/g, "''")}'`));
    const data = await this.get(`${base}/values:batchGet?${qs}`, 'à planilha');
    return {
      title: meta.properties?.title ?? '',
      tabs: titles.map((title, i) => ({
        title,
        rows: ((data.valueRanges?.[i]?.values ?? []) as unknown[][]).map((r) => r.map((c) => (c == null ? '' : String(c)))),
      })),
    };
  }

  /** Arquivos da pasta e das subpastas (até 6 níveis), com o MD5 que o Drive calcula */
  async listFolder(folderId: string): Promise<{ name: string; files: DriveFile[] }> {
    const root = await this.get(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`,
      'à pasta de fotos',
    );
    if (root.mimeType !== FOLDER) throw new ServiceUnavailableException('O link das fotos não é de uma pasta do Drive.');

    const files: DriveFile[] = [];
    const queue: { id: string; path: string[] }[] = [{ id: folderId, path: [] }];
    while (queue.length) {
      const { id, path } = queue.shift()!;
      let pageToken = '';
      do {
        const qs = new URLSearchParams({
          q: `'${id}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, md5Checksum, size, modifiedTime)',
          pageSize: '1000',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        });
        const page = await this.get(`https://www.googleapis.com/drive/v3/files?${qs}`, 'à pasta de fotos');
        for (const f of page.files ?? []) {
          if (f.mimeType === FOLDER) {
            if (path.length < 6) queue.push({ id: f.id, path: [...path, f.name] });
          } else {
            files.push({
              id: f.id,
              name: f.name,
              path,
              mimeType: f.mimeType,
              md5: f.md5Checksum ?? null,
              size: f.size ? Number(f.size) : null,
              modifiedTime: f.modifiedTime,
            });
          }
        }
        pageToken = page.nextPageToken ?? '';
      } while (pageToken);
    }
    return { name: root.name, files };
  }
}
