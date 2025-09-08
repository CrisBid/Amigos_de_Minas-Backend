/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs');
const fs = require('fs/promises');
const path = require('path');

// ==== Config ====
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'https://apiam.agropesg.com.br/';

// ==== FS helpers ====
async function ensureDir(absPath) { try { await fs.mkdir(absPath, { recursive: true }); } catch (_) {} }
async function writeIfNotExists(absPath, content) {
  try { await fs.access(absPath); } catch { await fs.writeFile(absPath, content); }
}

// ==== Utils ====
function parseBR(s) {
  const [d, m, y] = s.split('/');
  return new Date(Number(y), Number(m) - 1, Number(d));
}
function yearsDiff(from, to = new Date()) {
  let age = to.getFullYear() - from.getFullYear();
  const m = to.getMonth() - from.getMonth();
  if (m < 0 || (m === 0 && to.getDate() < from.getDate())) age--;
  return age;
}
function toTitle(s) {
  return s
    .toLowerCase()
    .split(' ')
    .map(tok => (['de','da','do','dos','das','e'].includes(tok) ? tok : tok.charAt(0).toUpperCase() + tok.slice(1)))
    .join(' ')
    .replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, m => m.toUpperCase());
}
function normalizeGift(x) {
  if (!x) return null;
  const s = x.trim();
  if (/^tênis/i.test(s)) return s;                  // mantém numeração/cor
  if (/material escolar/i.test(s)) return 'Material Escolar';
  if (/roupa/i.test(s)) return 'Roupas';
  if (/boneca/i.test(s)) return 'Boneca Bebê';
  if (/carreta/i.test(s)) return 'Carreta';
  if (/vestido/i.test(s)) return s;
  return toTitle(s);
}
const SCHOOL = 'Escola Municipal de Galho São Domingos';
const CAMPAIGN_PHOTO_KEY = (publicId) => `uploads/campaigns/2025/1101/${publicId}`;

// ==== Seed steps ====
async function upsertUsers() {
  const users = [
    { name: 'Admin',        email: 'admin@amigosdeminas.org',   password: 'Admin@123',   roles: ['ADMIN'] },
    { name: 'Equipe',       email: 'staff@amigosdeminas.org',   password: 'Staff@123',   roles: ['STAFF'] },
    { name: 'Padrinho Demo',email: 'sponsor@amigosdeminas.org', password: 'Sponsor@123', roles: ['SPONSOR'] },
  ];

  const created = [];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, passwordHash, roles: u.roles },
      create: { name: u.name, email: u.email, passwordHash, roles: u.roles },
    });
    created.push(user);
  }

  // perfil do padrinho demo
  const sponsor = created.find(u => u.email === 'sponsor@amigosdeminas.org');
  if (sponsor) {
    await prisma.profile.upsert({
      where: { userId: sponsor.id },
      update: { phone: '(31) 98888-7777', city: 'Montes Claros' },
      create: { userId: sponsor.id, phone: '(31) 98888-7777', city: 'Montes Claros' },
    });
  }

  return created;
}

async function upsertCampaigns() {
  const campaigns = [
    {
      publicId: 2025,
      slug: 'natal-2025',
      name: 'Campanha de Natal 2025',
      year: 2025,
      status: 'ACTIVE',
      frameConfig: { width: 1080, height: 1080, fit: 'cover', gravity: 'center', cornerRadius: 24 },
    },
  ];

  const out = [];
  for (const c of campaigns) {
    const campaign = await prisma.campaign.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name, year: c.year, status: c.status, publicId: c.publicId, frameConfig: c.frameConfig,
      },
      create: {
        name: c.name, slug: c.slug, year: c.year, status: c.status, publicId: c.publicId, frameConfig: c.frameConfig,
      },
    });
    out.push(campaign);
  }
  return out;
}

async function upsertCities() {
  // Não fixa id de Bonito; usa upsert por publicId/nome
  const cities = [
    { publicId: 1101, name: 'Bonito',                 state: 'MG' },
    { publicId: 1102, name: 'Itacarambi',             state: 'MG' },
    { publicId: 1103, name: 'Juvenília',              state: 'MG' },
    { publicId: 1104, name: 'Manga',                  state: 'MG' },
    { publicId: 1105, name: 'São João Das Missões',   state: 'MG' },
  ];

  const out = [];
  for (const c of cities) {
    const city = await prisma.city.upsert({
      where: { publicId: c.publicId },
      update: { name: c.name, state: c.state },
      create: { publicId: c.publicId, name: c.name, state: c.state },
    });
    out.push(city);
  }
  return out;
}

function pickCityByName(cities, name) {
  const c = cities.find(x => x.name === name);
  if (!c) throw new Error(`Cidade não encontrada no seed: ${name}`);
  return c;
}

async function upsertChildren(cities) {
  // Dados reais (print): todos de Bonito + escola Galho São Domingos
  const rows = [
    // Topo
    //{ publicId: 2177, name: 'TAMIRES CARNEIRO RIBEIRO',           birth: '13/05/2005', wantedGift: 'Roupas',                 category: 'Roupas' },
    //{ publicId: 2178, name: 'FABRÍCIO PEREIRA VIANA',              birth: '08/07/2015', wantedGift: 'Tênis (37/38)',          category: 'Tênis' },
    //{ publicId: 2149, name: 'ARTHUR CARNEIRO KIRICH FERNANDES',    birth: '24/03/2016', wantedGift: 'Carreta',                category: 'Carrinhos' },

    // Turma 5º ano (Professora: Rita de Cássia)
    { publicId: 2150, name: 'HELLEM BARBOSA LEITE',                birth: '06/01/2015', wantedGift: 'Roupas',                 category: 'Roupas' },
    { publicId: 2151, name: 'HENRIQUE BARBOSA SANTANA',            birth: '27/11/2014', wantedGift: 'Tênis (35/36)',          category: 'Tênis' },
    { publicId: 2152, name: 'ISTHELLA APARECIDA PEREIRA SANTOS',   birth: '16/05/2014', wantedGift: 'Roupas',                 category: 'Roupas' },
    { publicId: 2153, name: 'IVAN BARBOSA SANTANA',                 birth: '29/03/2015', wantedGift: 'Material Escolar',       category: 'Material Escolar' },
    { publicId: 2154, name: 'TIAGO BARBOSA DOS SANTOS',            birth: '16/05/2014', wantedGift: 'Material Escolar',       category: 'Material Escolar' },
    { publicId: 2155, name: 'ESTER RIBEIRO DE SENA',               birth: '26/01/2022', wantedGift: 'Boneca Bebê',            category: 'Bonecas' },
    { publicId: 2156, name: 'ELIZA NOGUEIRA SANTANA',              birth: '03/06/2017', wantedGift: 'Tênis Rosa (27/28)',     category: 'Tênis' },
    { publicId: 2157, name: 'MANUELA NOGUEIRA DE ALMEIDA SANTANA', birth: '03/11/2023', wantedGift: 'Vestido (Rosa)',         category: 'Roupas' },
  ];

  const city = pickCityByName(cities, 'Bonito');
  const out = [];

  for (const r of rows) {
    const birthDate = parseBR(r.birth);
    const age = yearsDiff(birthDate);

    const child = await prisma.child.upsert({
      where: { publicId: r.publicId },
      update: {
        name: toTitle(r.name),
        birthDate,
        age,
        cityId: city.id,
        cityName: city.name,
        school: SCHOOL,
        category: r.category || null,
        wantedGift: normalizeGift(r.wantedGift),
        photoKey: CAMPAIGN_PHOTO_KEY(r.publicId),
        photoUrl: API_PUBLIC_URL + CAMPAIGN_PHOTO_KEY(r.publicId) + "/" + "original.jpg",
        description: null,
        deletedAt: null,
      },
      create: {
        publicId: r.publicId,
        name: toTitle(r.name),
        birthDate,
        age,
        cityId: city.id,
        cityName: city.name,
        school: SCHOOL,
        category: r.category || null,
        wantedGift: normalizeGift(r.wantedGift),
        photoKey: CAMPAIGN_PHOTO_KEY(r.publicId),
        photoUrl: API_PUBLIC_URL + CAMPAIGN_PHOTO_KEY(r.publicId) + "/" + "original.jpg",
        description: null,
      },
    });
    out.push(child);
  }
  return out;
}

async function createSomeSponsorships(campaigns, users, children) {
  const sponsor = users.find(u => u.email === 'sponsor@amigosdeminas.org');
  const natal = campaigns.find(c => c.slug === 'natal-2025');
  if (!sponsor || !natal) return;

  // escolhe algumas crianças pelo publicId
  const targetPublicIds = [2149, 2153, 2177];
  for (const pid of targetPublicIds) {
    const child = children.find(c => c.publicId === pid);
    if (!child) continue;
    await prisma.sponsorship.upsert({
      where: { childId_campaignId: { childId: child.id, campaignId: natal.id } },
      update: { status: 'ACTIVE' },
      create: { childId: child.id, campaignId: natal.id, sponsorId: sponsor.id, status: 'ACTIVE' },
    });
  }
}

async function scaffoldFolders(campaigns, cities, children) {
  // uploads/campaigns/<campPublicId>/<cityPublicId>/<childPublicId>/
  const baseAbs = path.join(process.cwd(), UPLOAD_DIR);
  for (const camp of campaigns) {
    const campFolder = String(camp.publicId || camp.id);
    for (const city of cities) {
      const cityFolder = String(city.publicId || city.id);
      const kids = children.filter(c => c.cityId === city.id);
      for (const kid of kids) {
        const dir = path.join(baseAbs, 'campaigns', campFolder, cityFolder, String(kid.publicId));
        await ensureDir(dir);
        const readmePath = path.join(dir, 'README.txt');
        const note = `Cole aqui a foto original desta criança:

- Nome: ${kid.name}
- childPublicId: ${kid.publicId}
- Cidade: ${city.name} (${city.publicId})
- Campanha: ${camp.name} (${camp.publicId || camp.id})

Arquivos aceitos: original.jpg | original.png | original.webp
Após colar, acesse o front com ?scan=1 ou use POST /children/:childId/photo?campaignId=${camp.id}.`;
        await writeIfNotExists(readmePath, note);
      }
    }
  }
  console.log(`✔ Pastas criadas (se necessário) dentro de ${path.relative(process.cwd(), baseAbs)}`);
}

// ==== Runner ====
async function main() {
  console.log('🌱 Seeding…');

  const [users, campaigns, cities] = await Promise.all([
    upsertUsers(),
    upsertCampaigns(),
    upsertCities(),
  ]);

  const children = await upsertChildren(cities);
  await createSomeSponsorships(campaigns, users, children);
  await scaffoldFolders(campaigns, cities, children);

  console.log('✅ Seed finalizado.');
  console.log('   - Usuários: admin@amigosdeminas.org / Admin@123');
  console.log('               staff@amigosdeminas.org / Staff@123');
  console.log('               sponsor@amigosdeminas.org / Sponsor@123');
  console.log('   - Campanhas (slug):', campaigns.map(c => c.slug).join(', '));
  console.log(`   - Estrutura de uploads em: ${path.join(process.cwd(), UPLOAD_DIR)}`);
}

main()
  .catch(err => {
    console.error('❌ Seed falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
