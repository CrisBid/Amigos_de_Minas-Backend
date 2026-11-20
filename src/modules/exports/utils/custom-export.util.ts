// Exportação personalizável de apadrinhamentos: o usuário escolhe as colunas e o agrupamento,
// e ao final vem a lista dos padrinhos com os contatos.
import ExcelJS from 'exceljs';

export type ExportRow = {
  sponsorshipId: string;
  childId: string | null;
  /** criança da campanha ainda sem padrinho (linha sem apadrinhamento) */
  unsponsored?: boolean;
  publicId: number | null;
  childName: string;
  birthDate: string | null; // yyyy-mm-dd
  age: number | null;
  gift: string | null;
  mother: string | null;
  city: string | null;
  community: string | null;
  school: string | null;
  sponsorId: string | null;
  sponsorName: string | null;
  sponsorEmail: string | null;
  sponsorPhone: string | null;
  method: string | null; // PIX | GIFT
  donationAmount: number | null;
  status: string | null;
  statusLabel: string | null;
  collectionPoint: string | null;
  createdAt: string | null; // ISO
};

export type SponsorContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  children: number;
  communities: string[];
  collectionPoints: string[];
};

/** Colunas disponíveis, na ordem padrão. `default` = marcadas por padrão. */
export const EXPORT_FIELDS: { key: string; label: string; width: number; default?: boolean }[] = [
  { key: 'publicId', label: 'ID', width: 8, default: true },
  { key: 'childName', label: 'Criança', width: 30, default: true },
  { key: 'age', label: 'Idade', width: 8, default: true },
  { key: 'place', label: 'Comunidade / cidade', width: 28, default: true },
  { key: 'gift', label: 'Presente', width: 32, default: true },
  { key: 'sponsorName', label: 'Padrinho', width: 28, default: true },
  { key: 'birthDate', label: 'Nascimento', width: 12 },
  { key: 'mother', label: 'Mãe', width: 28 },
  { key: 'city', label: 'Cidade', width: 20 },
  { key: 'community', label: 'Comunidade', width: 22 },
  { key: 'school', label: 'Escola', width: 22 },
  { key: 'sponsorEmail', label: 'E-mail do padrinho', width: 30 },
  { key: 'sponsorPhone', label: 'Telefone do padrinho', width: 18 },
  { key: 'method', label: 'Forma', width: 12 },
  { key: 'donationAmount', label: 'Valor PIX', width: 12 },
  { key: 'statusLabel', label: 'Status', width: 18 },
  { key: 'collectionPoint', label: 'Ponto de coleta', width: 26 },
  { key: 'createdAt', label: 'Apadrinhado em', width: 14 },
];
export const DEFAULT_FIELDS = EXPORT_FIELDS.filter((f) => f.default).map((f) => f.key);

export type GroupBy = 'community' | 'city' | 'school' | 'sponsor' | 'collectionPoint' | 'none';

const br = (iso: string | null) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Valor de uma coluna, já como texto/número para a planilha */
export function cellValue(r: ExportRow, key: string): string | number {
  switch (key) {
    case 'place': return [r.community, r.city].filter(Boolean).join(' / ');
    case 'birthDate': return br(r.birthDate);
    case 'createdAt': return br(r.createdAt);
    case 'method': return r.method === 'PIX' ? 'PIX' : r.method === 'GIFT' ? 'Presente' : '';
    case 'age': return r.age ?? '';
    case 'publicId': return r.publicId ?? '';
    case 'donationAmount': return r.donationAmount ?? '';
    case 'sponsorName': return r.unsponsored ? 'Sem padrinho' : r.sponsorName ?? '';
    default: {
      const v = (r as Record<string, unknown>)[key];
      return v == null ? '' : (v as string | number);
    }
  }
}

/** Nome do grupo de cada linha (comunidade leva a cidade junto: há nomes repetidos entre cidades) */
export function groupLabel(r: ExportRow, by: GroupBy): string {
  switch (by) {
    case 'community': return r.community ? `${r.community}${r.city ? ` (${r.city})` : ''}` : `Sem comunidade${r.city ? ` (${r.city})` : ''}`;
    case 'city': return r.city || 'Sem cidade';
    case 'school': return r.school || 'Sem escola';
    case 'sponsor': return r.unsponsored ? FREE_LABEL : r.sponsorName || 'Sem padrinho';
    case 'collectionPoint': return r.unsponsored ? FREE_LABEL : r.collectionPoint || 'Sem ponto de coleta';
    default: return 'Apadrinhamentos';
  }
}

export const FREE_LABEL = 'Crianças sem padrinho';

const cmp = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });

/** ordem dentro do grupo; "sponsor" = por padrinho (as sem padrinho no fim) e, dentro dele, por ID */
export type SortBy = 'name' | 'id' | 'sponsor';

/** Linhas agrupadas e ordenadas (grupos por nome; dentro do grupo, por criança) */
/** Dentro do grupo: por nome da criança ou pelo ID */
const byId = (x: ExportRow, y: ExportRow) => (x.publicId ?? 1e9) - (y.publicId ?? 1e9) || cmp(x.childName ?? '', y.childName ?? '');
const byRow = (sortBy: SortBy) => (x: ExportRow, y: ExportRow) =>
  sortBy === 'id' ? byId(x, y)
  : sortBy === 'sponsor' ? Number(!!x.unsponsored) - Number(!!y.unsponsored) || cmp(x.sponsorName ?? '', y.sponsorName ?? '') || byId(x, y)
  : cmp(x.childName ?? '', y.childName ?? '');

export function groupRows(rows: ExportRow[], by: GroupBy, sortBy: SortBy = 'name') {
  const map = new Map<string, { label: string; sort: string; rows: ExportRow[] }>();
  for (const r of rows) {
    const label = groupLabel(r, by);
    // as sem padrinho (quando o grupo é padrinho ou ponto de coleta) ficam no fim
    const sort = label === FREE_LABEL ? '\uffff' : by === 'community' ? `${r.city ?? '~'}|${r.community ?? '~'}` : label;
    const g = map.get(label) ?? { label, sort, rows: [] };
    g.rows.push(r);
    map.set(label, g);
  }
  return [...map.values()]
    .sort((a, b) => cmp(a.sort, b.sort))
    .map((g) => ({ label: g.label, rows: [...g.rows].sort(byRow(sortBy)) }));
}

/** Padrinhos dos apadrinhamentos exportados, com contato e quantas crianças */
export function sponsorContacts(rows: ExportRow[]): SponsorContact[] {
  const map = new Map<string, SponsorContact & { _c: Set<string>; _p: Set<string> }>();
  for (const r of rows) {
    if (!r.sponsorId) continue;
    const s = map.get(r.sponsorId) ?? {
      id: r.sponsorId, name: r.sponsorName ?? '', email: r.sponsorEmail, phone: r.sponsorPhone,
      children: 0, communities: [], collectionPoints: [], _c: new Set<string>(), _p: new Set<string>(),
    };
    s.children++;
    if (r.community || r.city) s._c.add(groupLabel(r, 'community'));
    if (r.collectionPoint) s._p.add(r.collectionPoint);
    map.set(r.sponsorId, s);
  }
  return [...map.values()]
    .map(({ _c, _p, ...s }) => ({ ...s, communities: [..._c].sort(cmp), collectionPoints: [..._p].sort(cmp) }))
    .sort((a, b) => cmp(a.name, b.name));
}

export type SponsorInGroup = { id: string; name: string; email: string | null; phone: string | null; children: number; ids: number[] };

/**
 * Padrinhos separados por grupo: comunidade (padrão) ou, se a lista estiver separada por
 * cidade/escola/ponto de coleta, o mesmo grupo dela. Quem apadrinha em mais de uma comunidade
 * aparece em cada uma, com as crianças daquela comunidade.
 */
export function sponsorGroups(rows: ExportRow[], by: GroupBy, sortBy: SortBy = 'name') {
  const sponsorBy: GroupBy = by === 'city' || by === 'school' || by === 'collectionPoint' ? by : 'community';
  return groupRows(rows.filter((r) => r.sponsorId), sponsorBy, sortBy).map((g) => {
    const map = new Map<string, SponsorInGroup>();
    for (const r of g.rows) {
      const s = map.get(r.sponsorId!) ?? { id: r.sponsorId!, name: r.sponsorName ?? '', email: r.sponsorEmail, phone: r.sponsorPhone, children: 0, ids: [] };
      s.children++;
      if (r.publicId != null) s.ids.push(r.publicId);
      map.set(r.sponsorId!, s);
    }
    const sponsors = [...map.values()]
      .map((s) => ({ ...s, ids: [...s.ids].sort((a, b) => a - b) }))
      .sort((a, b) => cmp(a.name, b.name));
    return { label: g.label, sponsors };
  });
}

export type GiftCount = { gift: string; count: number; ids: number[] };

/**
 * Resumo dos presentes: em cada comunidade (ou no mesmo grupo da lista, se for cidade/escola/
 * ponto de coleta), quantos de cada presente — o mesmo presente escrito igual é somado,
 * sem diferença de maiúsculas e espaços. Ordem: mais pedidos primeiro.
 */
export function giftSummary(rows: ExportRow[], by: GroupBy) {
  const giftBy: GroupBy = by === 'city' || by === 'school' || by === 'collectionPoint' ? by : 'community';
  // só as apadrinhadas: é a lista do que será comprado/entregue
  return groupRows(rows.filter((r) => !r.unsponsored), giftBy, 'id').map((g) => {
    const map = new Map<string, GiftCount>();
    for (const r of g.rows) {
      const text = (r.gift ?? '').trim().replace(/\s+/g, ' ');
      const key = text.toUpperCase() || '~';
      const item = map.get(key) ?? { gift: text ? text.toUpperCase() : '(sem presente informado)', count: 0, ids: [] };
      item.count++;
      if (r.publicId != null) item.ids.push(r.publicId);
      map.set(key, item);
    }
    const gifts = [...map.values()].sort((a, b) => b.count - a.count || cmp(a.gift, b.gift));
    return { label: g.label, total: g.rows.length, gifts };
  });
}

/* —— padrinhos e pontos de coleta do conjunto exportado —— */

/** Colunas da lista de padrinhos (página/aba final) */
export const SPONSOR_FIELDS: { key: string; label: string; width: number; weight: number; default?: boolean }[] = [
  { key: 'name', label: 'Padrinho', width: 30, weight: 2.2, default: true },
  { key: 'count', label: 'Crianças', width: 10, weight: 0.8, default: true },
  { key: 'method', label: 'Forma', width: 20, weight: 1.4, default: true },
  { key: 'email', label: 'E-mail', width: 32, weight: 2.2, default: true },
  { key: 'phone', label: 'Telefone', width: 18, weight: 1.3, default: true },
  { key: 'pixAmount', label: 'Valor PIX', width: 12, weight: 1 },
  { key: 'points', label: 'Pontos de coleta', width: 30, weight: 2 },
  { key: 'communities', label: 'Comunidades', width: 34, weight: 2.2 },
  { key: 'ids', label: 'IDs das crianças', width: 34, weight: 2 },
];
export const DEFAULT_SPONSOR_FIELDS = SPONSOR_FIELDS.filter((f) => f.default).map((f) => f.key);

export type SponsorStats = {
  id: string; name: string; email: string | null; phone: string | null;
  count: number; gift: number; pix: number; pixAmount: number;
  points: string[]; communities: string[]; ids: number[];
};

/** Um padrinho por linha, com o que ele tem neste conjunto */
export function sponsorStats(rows: ExportRow[]): SponsorStats[] {
  const map = new Map<string, SponsorStats & { _p: Set<string>; _c: Set<string> }>();
  for (const r of rows) {
    if (r.unsponsored || !r.sponsorId) continue;
    const s = map.get(r.sponsorId) ?? {
      id: r.sponsorId, name: r.sponsorName ?? '', email: r.sponsorEmail, phone: r.sponsorPhone,
      count: 0, gift: 0, pix: 0, pixAmount: 0, points: [], communities: [], ids: [], _p: new Set<string>(), _c: new Set<string>(),
    };
    s.count++;
    if (r.method === 'PIX') { s.pix++; s.pixAmount += r.donationAmount ?? 0; } else s.gift++;
    if (r.collectionPoint) s._p.add(r.collectionPoint);
    if (r.community || r.city) s._c.add(groupLabel(r, 'community'));
    if (r.publicId != null) s.ids.push(r.publicId);
    map.set(r.sponsorId, s);
  }
  return [...map.values()]
    .map(({ _p, _c, ...s }) => ({ ...s, points: [..._p].sort(cmp), communities: [..._c].sort(cmp), ids: [...s.ids].sort((a, b) => a - b) }))
    .sort((a, b) => cmp(a.name, b.name));
}

/** "2 presentes · 1 PIX" */
export const methodText = (gift: number, pix: number) =>
  [gift ? `${gift} presente${gift === 1 ? '' : 's'}` : '', pix ? `${pix} PIX` : ''].filter(Boolean).join(' · ');

export function sponsorCell(s: SponsorStats, key: string): string | number {
  switch (key) {
    case 'name': return s.name;
    case 'count': return s.count;
    case 'method': return methodText(s.gift, s.pix);
    case 'email': return s.email ?? '';
    case 'phone': return s.phone ?? '';
    case 'pixAmount': return s.pixAmount ? s.pixAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
    case 'points': return s.points.join('; ');
    case 'communities': return s.communities.join('; ');
    case 'ids': return s.ids.join(', ');
    default: return '';
  }
}

export type PointSummary = {
  label: string; kind: 'point' | 'pix' | 'none';
  children: number; sponsors: number; received: number; pending: number; communities: string[];
};
/** já recebidos no galpão ou entregues */
const RECEIVED_STATUS = ['PACKED', 'BOXED', 'COMPLETED'];

/** Resumo por ponto de coleta (PIX e presente sem ponto em linhas próprias; sem padrinho fica de fora) */
export function pointSummary(rows: ExportRow[]): PointSummary[] {
  const map = new Map<string, PointSummary & { _s: Set<string>; _c: Set<string> }>();
  for (const r of rows) {
    if (r.unsponsored) continue;
    const kind: PointSummary['kind'] = r.method === 'PIX' ? 'pix' : r.collectionPoint ? 'point' : 'none';
    const label = kind === 'pix' ? 'PIX (presente comprado pela equipe)' : kind === 'none' ? 'Presente sem ponto de coleta' : r.collectionPoint!;
    const p = map.get(label) ?? { label, kind, children: 0, sponsors: 0, received: 0, pending: 0, communities: [], _s: new Set<string>(), _c: new Set<string>() };
    p.children++;
    if (r.status && RECEIVED_STATUS.includes(r.status)) p.received++;
    if (r.status === 'PENDING') p.pending++;
    if (r.sponsorId) p._s.add(r.sponsorId);
    if (r.community || r.city) p._c.add(groupLabel(r, 'community'));
    map.set(label, p);
  }
  return [...map.values()]
    .map(({ _s, _c, ...p }) => ({ ...p, sponsors: _s.size, communities: [..._c].sort(cmp) }))
    .sort((a, b) => Number(a.kind !== 'point') - Number(b.kind !== 'point') || cmp(a.label, b.label));
}

/** Nome de aba válido no Excel (31 letras, sem : \ / ? * [ ]) e sem repetir */
function sheetName(label: string, used: Set<string>) {
  const base = label.replace(/[:\\/?*[\]]/g, '-').trim().slice(0, 31) || 'Aba';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF25A273' } };
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5EF' } };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = HEADER_FILL;
  });
}

/**
 * Planilha personalizada:
 * - layout "tabs": uma aba por grupo (comunidade, cidade…);
 * - layout "single": uma aba só, com uma linha de título antes de cada grupo;
 * e, se pedido, a aba "Padrinhos" com os contatos.
 */
export async function buildCustomExcel(opts: {
  rows: ExportRow[];
  fields: string[];
  groupBy: GroupBy;
  layout: 'tabs' | 'single';
  sponsorList: boolean;
  giftSummary?: boolean;
  sortBy?: SortBy;
  title?: string;
  /** colunas da aba de padrinhos */
  sponsorFields?: string[];
  /** aba com o resumo dos pontos de coleta */
  pointsSummary?: boolean;
}) {
  const fields = opts.fields.map((k) => EXPORT_FIELDS.find((f) => f.key === k)).filter(Boolean) as typeof EXPORT_FIELDS;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Amigos de Minas';
  wb.created = new Date();
  const used = new Set<string>();
  const groups = groupRows(opts.rows, opts.groupBy, opts.sortBy ?? 'name');
  const columns = fields.map((f) => ({ header: f.label, key: f.key, width: f.width }));
  const lastCol = String.fromCharCode(64 + Math.min(fields.length, 26));

  const addData = (ws: ExcelJS.Worksheet, rows: ExportRow[]) => {
    for (const r of rows) {
      const row = ws.addRow(Object.fromEntries(fields.map((f) => [f.key, cellValue(r, f.key)])));
      row.alignment = { vertical: 'top', wrapText: true };
      const money = fields.findIndex((f) => f.key === 'donationAmount');
      if (money >= 0) row.getCell(money + 1).numFmt = '"R$" #,##0.00';
    }
  };

  if (opts.giftSummary) {
    const ws = wb.addWorksheet(sheetName('Resumo dos presentes', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Presente', key: 'gift', width: 44 },
      { header: 'Quantidade', key: 'count', width: 12 },
      { header: 'IDs das crianças', key: 'ids', width: 50 },
    ];
    styleHeader(ws.getRow(1));
    for (const g of giftSummary(opts.rows, opts.groupBy)) {
      const t = ws.addRow([`${g.label} — ${g.total} criança(s), ${g.gifts.length} presente(s) diferente(s)`]);
      ws.mergeCells(t.number, 1, t.number, 3);
      t.getCell(1).font = { bold: true, color: { argb: 'FF1F5F47' } };
      t.getCell(1).fill = GROUP_FILL;
      for (const it of g.gifts) {
        ws.addRow({ gift: it.gift, count: it.count, ids: it.ids.join(', ') }).alignment = { vertical: 'top', wrapText: true };
      }
    }
  }

  if (opts.layout === 'tabs' && opts.groupBy !== 'none') {
    for (const g of groups) {
      const ws = wb.addWorksheet(sheetName(g.label, used), { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = columns;
      styleHeader(ws.getRow(1));
      addData(ws, g.rows);
      ws.autoFilter = { from: 'A1', to: `${lastCol}1` };
    }
  } else {
    const ws = wb.addWorksheet(sheetName(opts.title || 'Apadrinhamentos', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns;
    styleHeader(ws.getRow(1));
    for (const g of groups) {
      if (opts.groupBy !== 'none') {
        const t = ws.addRow([`${g.label} — ${g.rows.length} criança(s)`]);
        ws.mergeCells(t.number, 1, t.number, Math.max(1, fields.length));
        t.getCell(1).font = { bold: true, color: { argb: 'FF1F5F47' } };
        t.getCell(1).fill = GROUP_FILL;
      }
      addData(ws, g.rows);
    }
  }

  if (opts.pointsSummary) {
    const ws = wb.addWorksheet(sheetName('Pontos de coleta', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Ponto de coleta', key: 'label', width: 40 },
      { header: 'Crianças', key: 'children', width: 10 },
      { header: 'Padrinhos', key: 'sponsors', width: 10 },
      { header: 'Recebidos', key: 'received', width: 11 },
      { header: 'Pendentes', key: 'pending', width: 11 },
      { header: 'Comunidades', key: 'communities', width: 60 },
    ];
    styleHeader(ws.getRow(1));
    for (const p of pointSummary(opts.rows)) {
      ws.addRow({ ...p, communities: p.communities.join('; ') }).alignment = { vertical: 'top', wrapText: true };
    }
  }

  if (opts.sponsorList) {
    const sf = (opts.sponsorFields?.length ? opts.sponsorFields : DEFAULT_SPONSOR_FIELDS)
      .map((k) => SPONSOR_FIELDS.find((f) => f.key === k)).filter(Boolean) as typeof SPONSOR_FIELDS;
    const ws = wb.addWorksheet(sheetName('Padrinhos', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sf.map((f) => ({ header: f.label, key: f.key, width: f.width }));
    styleHeader(ws.getRow(1));
    // separados pelo mesmo grupo da lista (comunidade, se for por padrinho ou sem grupo)
    const by: GroupBy = opts.groupBy === 'city' || opts.groupBy === 'school' || opts.groupBy === 'collectionPoint' ? opts.groupBy : 'community';
    for (const g of groupRows(opts.rows.filter((r) => r.sponsorId && !r.unsponsored), by, opts.sortBy ?? 'name')) {
      const list = sponsorStats(g.rows);
      const t = ws.addRow([`${g.label} — ${list.length} padrinho(s)`]);
      ws.mergeCells(t.number, 1, t.number, Math.max(1, sf.length));
      t.getCell(1).font = { bold: true, color: { argb: 'FF1F5F47' } };
      t.getCell(1).fill = GROUP_FILL;
      for (const s of list) {
        ws.addRow(Object.fromEntries(sf.map((f) => [f.key, sponsorCell(s, f.key)]))).alignment = { vertical: 'top', wrapText: true };
      }
    }
  }

  if (!wb.worksheets.length) wb.addWorksheet('Vazio').addRow(['Nenhum apadrinhamento com estes filtros.']);
  return wb.xlsx.writeBuffer();
}
