// src/modules/exports/utils/excel.util.ts
import ExcelJS from 'exceljs';

export type ChildRow = {
  publicId: number | null;
  childName: string;
  birthDate: string | null;
  age: number | null;
  mother: string | null;

  // vinculação
  hasSponsor: boolean;
  sponsorName: string | null;
  sponsorContact: string | null;
  method: string | null;
  pix: string | null;
  collectionPoint: string | null;
  gift: string | null;

  // localização
  city: string | null;
  community: string | null;
  school: string | null;

  // chaves de agrupamento
  _cityKey: string;
  _communityKey: string;
  _schoolKey: string;
};

export type ExcelLevel = 'general' | 'city' | 'community' | 'selection';

function groupBy<T>(arr: T[], keyFn: (i: T) => string) {
  return arr.reduce((acc, item) => {
    const key = (keyFn(item) || 'Sem informação').substring(0, 31);
    (acc[key] ||= []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// Opcional: mapeia método para PT-BR ao exportar
const METHOD_PT: Record<string, string> = {
  GIFT: 'Presente',
  PIX: 'Pix',
};

export async function buildChildrenExcel(rows: ChildRow[], level: ExcelLevel) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Amigos de Minas';
  wb.created = new Date();

  let grouped: Record<string, ChildRow[]>;
  switch (level) {
    case 'general':
      grouped = groupBy(rows, (r) => r._cityKey || 'Sem cidade');
      break;
    case 'city':
      grouped = groupBy(rows, (r) => r._communityKey || 'Sem comunidade');
      break;
    case 'community':
      grouped = groupBy(rows, (r) => r._schoolKey || 'Sem escola');
      break;
    case 'selection':
    default:
      grouped = groupBy(rows, (r) => r._cityKey || 'Sem cidade');
      break;
  }

  for (const [sheetName, items] of Object.entries(grouped)) {
    const sheet = wb.addWorksheet(sheetName);

    sheet.columns = [
      { header: 'PUBLICID', key: 'publicId', width: 12 },
      { header: 'CRIANÇA', key: 'childName', width: 26 },
      { header: 'NASCIMENTO', key: 'birthDate', width: 14 },
      { header: 'IDADE', key: 'age', width: 8 },
      { header: 'MÃE', key: 'mother', width: 24 },
      { header: 'APADRINHADA', key: 'hasSponsor', width: 14 },
      { header: 'PADRINHO', key: 'sponsorName', width: 26 },
      { header: 'CONTATO', key: 'sponsorContact', width: 22 },
      { header: 'FORMA', key: 'method', width: 18 }, // um pouco maior para “Presente”
      { header: 'PIX', key: 'pix', width: 26 },
      { header: 'PONTO DE ENTREGA', key: 'collectionPoint', width: 26 },
      { header: 'PRESENTE', key: 'gift', width: 24 },
      { header: 'CIDADE', key: 'city', width: 20 },
      { header: 'COMUNIDADE', key: 'community', width: 20 },
      { header: 'ESCOLA', key: 'school', width: 20 },
    ];

    // Estilo do cabeçalho
    sheet.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF25A273' } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      c.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // Congela linha do cabeçalho
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Linhas
    for (const r of items) {
      sheet.addRow({
        publicId: r.publicId ?? '',
        childName: r.childName ?? '',
        birthDate: r.birthDate ?? '',
        age: r.age ?? '',
        mother: r.mother ?? '',
        hasSponsor: r.hasSponsor ? 'SIM' : 'NÃO',
        sponsorName: r.sponsorName ?? '',
        sponsorContact: r.sponsorContact ?? '',
        method: r.method ? (METHOD_PT[r.method] ?? r.method) : '',
        pix: r.pix ?? '',
        collectionPoint: r.collectionPoint ?? '',
        gift: r.gift ?? '',
        city: r.city ?? '',
        community: r.community ?? '',
        school: r.school ?? '',
      });
    }

    sheet.autoFilter = { from: 'A1', to: 'O1' };
  }

  return wb.xlsx.writeBuffer();
}
