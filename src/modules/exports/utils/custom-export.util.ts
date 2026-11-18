// Exportação personalizável de apadrinhamentos: o usuário escolhe as colunas e o agrupamento,
// e ao final vem a lista dos padrinhos com os contatos.
import ExcelJS from 'exceljs';

export type ExportRow = {
  sponsorshipId: string;
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
    case 'sponsor': return r.sponsorName || 'Sem padrinho';
    case 'collectionPoint': return r.collectionPoint || 'Sem ponto de coleta';
    default: return 'Apadrinhamentos';
  }
}

const cmp = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });

export type SortBy = 'name' | 'id';

/** Linhas agrupadas e ordenadas (grupos por nome; dentro do grupo, por criança) */
/** Dentro do grupo: por nome da criança ou pelo ID */
const byRow = (sortBy: SortBy) => (x: ExportRow, y: ExportRow) =>
  sortBy === 'id' ? (x.publicId ?? 1e9) - (y.publicId ?? 1e9) || cmp(x.childName ?? '', y.childName ?? '') : cmp(x.childName ?? '', y.childName ?? '');

export function groupRows(rows: ExportRow[], by: GroupBy, sortBy: SortBy = 'name') {
  const map = new Map<string, { label: string; sort: string; rows: ExportRow[] }>();
  for (const r of rows) {
    const label = groupLabel(r, by);
    const sort = by === 'community' ? `${r.city ?? '~'}|${r.community ?? '~'}` : label;
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
  sortBy?: SortBy;
  title?: string;
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

  if (opts.sponsorList) {
    const ws = wb.addWorksheet(sheetName('Padrinhos', used), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Padrinho', key: 'name', width: 32 },
      { header: 'E-mail', key: 'email', width: 34 },
      { header: 'Telefone', key: 'phone', width: 18 },
      { header: 'Crianças', key: 'children', width: 10 },
      { header: 'Comunidades', key: 'communities', width: 40 },
      { header: 'Ponto de coleta', key: 'points', width: 30 },
    ];
    styleHeader(ws.getRow(1));
    for (const s of sponsorContacts(opts.rows)) {
      ws.addRow({
        name: s.name, email: s.email ?? '', phone: s.phone ?? '', children: s.children,
        communities: s.communities.join('; '), points: s.collectionPoints.join('; '),
      }).alignment = { vertical: 'top', wrapText: true };
    }
    ws.autoFilter = { from: 'A1', to: 'F1' };
  }

  if (!wb.worksheets.length) wb.addWorksheet('Vazio').addRow(['Nenhum apadrinhamento com estes filtros.']);
  return wb.xlsx.writeBuffer();
}
