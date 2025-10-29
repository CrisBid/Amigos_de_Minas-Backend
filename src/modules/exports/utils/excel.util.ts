// src/modules/exports/utils/excel.util.ts
import ExcelJS from 'exceljs';

export type ChildRow = {
  publicId: number | null;
  childName: string;
  birthDate: string | null;
  age: number | null;
  gift: string | null;
  mother: string | null;

  sponsorName: string | null;
  contact: string | null;
  method: string | null;
  pix: string | null;
  collectionPoint: string | null;

  city: string | null;
  community: string | null;
  school: string | null;

  // chaves para agrupamento dinâmico
  _cityKey: string;
  _communityKey: string;
  _schoolKey: string;
  _sponsorKey: string;
  
  status?: string | null;       // ex.: "IN_PROGRESS"
  statusLabel?: string | null;  // ex.: "Em andamento"
};
export type ExcelLevel =
  | 'general'     // agrupa por cidade
  | 'city'        // agrupa por comunidade
  | 'community'   // agrupa por escola
  | 'sponsor'     // agrupa por padrinho
  | 'selection';  // default: por cidade (pode ajustar)

function groupBy<T>(arr: T[], keyFn: (i: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = (keyFn(item) || 'Sem informação').substring(0, 31);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

export async function buildExcelBuffer(rows: ChildRow[], level: ExcelLevel) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Amigos de Minas';
  wb.created = new Date();

  // Decide agrupamento por nível
  let grouped: Record<string, ChildRow[]>;
  switch (level) {
    case 'general':
      grouped = groupBy(rows, r => r._cityKey || 'Sem cidade');
      break;
    case 'city':
      grouped = groupBy(rows, r => r._communityKey || 'Sem comunidade');
      break;
    case 'community':
      grouped = groupBy(rows, r => r._schoolKey || 'Sem escola');
      break;
    case 'sponsor':
      grouped = groupBy(rows, r => r._sponsorKey || 'Sem padrinho');
      break;
    case 'selection':
    default:
      grouped = groupBy(rows, r => r._cityKey || 'Sem cidade');
      break;
  }

  for (const [sheetName, items] of Object.entries(grouped)) {
    const sheet = wb.addWorksheet(sheetName);

    // 2) Colunas: insira antes ou depois de onde preferir
    sheet.columns = [
      { header: 'PUBLICID', key: 'publicId', width: 12 },
      { header: 'CRIANÇA', key: 'childName', width: 25 },
      { header: 'NASCIMENTO', key: 'birthDate', width: 15 },
      { header: 'IDADE', key: 'age', width: 8 },
      { header: 'PRESENTE', key: 'gift', width: 25 },
      { header: 'MÃE', key: 'mother', width: 25 },

      // ▼ novas (status técnico e label PT-BR)
      { header: 'STATUS', key: 'status', width: 18 },
      { header: 'STATUS (PT)', key: 'statusLabel', width: 22 },

      { header: 'PADRINHO', key: 'sponsorName', width: 25 },
      { header: 'CONTATO', key: 'contact', width: 25 },
      { header: 'FORMA DE APADRINHAMENTO', key: 'method', width: 25 },
      { header: 'PIX', key: 'pix', width: 28 },
      { header: 'PONTO DE ENTREGA', key: 'collectionPoint', width: 28 },
      { header: 'CIDADE', key: 'city', width: 22 },
      { header: 'COMUNIDADE', key: 'community', width: 22 },
      { header: 'ESCOLA', key: 'school', width: 22 },
    ];

    // Cabeçalho
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF25A273' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // Linhas
    for (const r of items) {
      // 3) Linhas: apenas passe os novos campos
      sheet.addRow({
        publicId: r.publicId ?? '',
        childName: r.childName ?? '',
        birthDate: r.birthDate ?? '',
        age: r.age ?? '',
        gift: r.gift ?? '',
        mother: r.mother ?? '',

        status: r.status ?? '',               // novo
        statusLabel: r.statusLabel ?? '',     // novo

        sponsorName: r.sponsorName ?? '',
        contact: r.contact ?? '',
        method: r.method ?? '',
        pix: r.pix ?? '',
        collectionPoint: r.collectionPoint ?? '',
        city: r.city ?? '',
        community: r.community ?? '',
        school: r.school ?? '',
      });
    }

    sheet.autoFilter = { from: 'A1', to: 'P1' };
  }

  return wb.xlsx.writeBuffer();
}
