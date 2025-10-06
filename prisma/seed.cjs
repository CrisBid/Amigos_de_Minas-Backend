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
function toTitle(s) {
  return s
    .toLowerCase()
    .split(' ')
    .map(tok => (['de','da','do','dos','das','e'].includes(tok) ? tok : tok.charAt(0).toUpperCase() + tok.slice(1)))
    .join(' ')
    .replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, m => m.toUpperCase());
}
const slugify = (s) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
   .toLowerCase().trim()
   .replace(/[^a-z0-9]+/g, '-')
   .replace(/^-+|-+$/g, '');

// ============== DADOS PARA PREENCHER ==============
// Formatos aceitos:
//
// COMMUNITIES_BY_CITY:
//  'Cidade': [
//    'Nome Simples',
//    { name: 'Nome', publicId?: 123, description?: '...' }
//  ]
//
// SCHOOLS_BY_CITY:
//  'Cidade': [
//    'Escola Simples',
//    { name: 'EE Bonito', publicId?: 456, address?: 'Rua X',
//      communityName?: 'Comunidade Y' } // opcional: vincula à comunidade
//  ]
//
const COMMUNITIES_BY_CITY = {
  'São João Das Missões': [
    'Brejo Mata Fome',
    'Embaúbas II',
    "Olho D'Aguão",
    'Pedra Redonda',
    'Riachão',
    'Riachinho',
    'Terra Preta',
    'Sumaré II',
    'Sumaré III',
  ],

  'Juvenília': [
    'Porto Agrário',
    'Ouro Verde',
    'Bananeira',
    'Monte Rei',
    'Lageado',
  ],

  'Bonito': [
    'Água Doce',
    'Larga',
    'São Domingos',
    'Japão',
    'Croá',
    'Salto Do Borrachudo',
    'Lalãozinho',
    'Almescla',
    'Sumidouro',
    'Cajueiro',
    'Barra Da Ema',
  ],

  'Itacarambi': [
    'Beira Rio',
    'Nossa Senhora De Fátima',
    'Corredor Da Siriema',
    'Abrigo',
  ],

  'Manga': [
    'Justa II',
  ],
};


const SCHOOLS_BY_CITY = {
  // São João Das Missões
  'São João Das Missões': [
    // Escola compartilhada entre várias comunidades:
    { name: 'ESCOLA EST IND BUKIMUJÚ', communityName: 'Brejo Mata Fome' },
    { name: 'ESCOLA EST IND BUKIMUJÚ', communityName: 'Embaúbas II' },
    { name: "ESCOLA EST IND BUKIMUJÚ", communityName: "Olho D'Aguão" },
    { name: 'ESCOLA EST IND BUKIMUJÚ', communityName: 'Pedra Redonda' },
    { name: 'ESCOLA EST IND BUKIMUJÚ', communityName: 'Riachão' },
    { name: 'ESCOLA EST IND BUKIMUJÚ', communityName: 'Riachinho' },
    { name: 'ESCOLA EST IND BUKIMUJÚ', communityName: 'Terra Preta' },

    // Outras comunidades com outra escola:
    { name: 'ESCOLA EST IND KUIRO PTE', communityName: 'Sumaré II' },
    { name: 'ESCOLA EST IND KUIRO PTE', communityName: 'Sumaré III' },
  ],

  // Juvenília
  'Juvenília': [
    { name: 'ESCOLA MUNICIPAL MARIA FERREIRA MARINHO', communityName: 'Bananeira' },
    { name: 'PRÉ ESCOLAR MUNICIPAL MONTE REI',          communityName: 'Monte Rei' },
    { name: 'ESCOLA MUNICIPAL NESTOR MESQUITA MARTINS FILHO', communityName: 'Lageado' },
    // Porto Agrário e Ouro Verde sem escola informada (mantidos apenas nas comunidades)
  ],

  // Bonito
  'Bonito': [
    { name: 'ESCOLA DA BARRA DA EMA', communityName: 'Barra Da Ema' },
    { name: 'ESCOLA MUNICIPAL DO CAJUEIRO', communityName: 'Cajueiro' },
    { name: 'ESCOLA MUNICIPAL DE SUMIDOURO', communityName: 'Sumidouro' },

    { name: 'ESCOLA MUNICIPAL LOURENÇO ALVES DA ROCHA', communityName: 'Almescla' },
    { name: 'ESCOLA MUNICIPAL ELZITA GASPARINO PIMENTA', communityName: 'Lalãozinho' },
    { name: 'ESCOLA MUNICIPAL ELZITA GASPARINO PIMENTA – TV SALTO', communityName: 'Salto Do Borrachudo' },
    { name: 'ESCOLA MUNICIPAL GALHO DE SÃO DOMINGOS – TV CROÁ', communityName: 'Croá' },
    { name: 'ESCOLA MUNICIPAL GALHO DE SÃO DOMINGOS – ASSENTAMENTO INCRA', communityName: 'Japão' },
    { name: 'ESCOLA MUNICIPAL GALHO DE SÃO DOMINGOS', communityName: 'São Domingos' },
    { name: 'ESCOLA MUNICIPAL FRANCISCO BORGES MONTEIRO', communityName: 'Larga' },
    { name: 'ESCOLA MUNICIPAL FRANCISCO BORGES MONTEIRO', communityName: 'Água Doce' },
  ],

  // Itacarambi (sem escolas informadas específicas)
  'Itacarambi': [
    // Adicione aqui quando tiver os nomes
  ],

  // Manga
  'Manga': [
    { name: 'CENTRO PETER PAM', communityName: 'Justa II' },
    { name: 'ESCOLA MAMÉDIO PEREIRA', communityName: 'Justa II' },
  ],
};


// ============== STEPS BÁSICOS (USERS / CAMPANHAS / CIDADES) ==============
async function upsertUsers() {
  const users = [
    { name: 'Admin', email: 'admin@amigosdeminas.org', password: 'Admin@123', roles: ['ADMIN'] },
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
  const cities = [
    { publicId: 1101, name: 'Bonito',               state: 'MG' },
    { publicId: 1102, name: 'Itacarambi',           state: 'MG' },
    { publicId: 1103, name: 'Juvenília',            state: 'MG' },
    { publicId: 1104, name: 'Manga',                state: 'MG' },
    { publicId: 1105, name: 'São João Das Missões', state: 'MG' },
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

// ============== COMUNIDADES ==============
async function upsertCommunities(cities) {
  const createdOrUpdated = [];
  for (const [cityName, entries] of Object.entries(COMMUNITIES_BY_CITY)) {
    const city = pickCityByName(cities, cityName);
    if (!Array.isArray(entries) || entries.length === 0) continue;

    for (const entry of entries) {
      const nameRaw = typeof entry === 'string' ? entry : entry.name;
      const name = toTitle(nameRaw);
      const publicId = typeof entry === 'object' ? entry.publicId : undefined;
      const description = typeof entry === 'object' ? entry.description : undefined;
      const slug = slugify(name);

      let community;
      if (publicId) {
        // publicId é único
        community = await prisma.community.upsert({
          where: { publicId },
          update: { name, slug, description, cityId: city.id },
          create: { publicId, name, slug, description, cityId: city.id },
        });
      } else {
        // usa unique composto @@unique([cityId, name]) -> where: { cityId_name: { ... } }
        community = await prisma.community.upsert({
          where: { cityId_name: { cityId: city.id, name } },
          update: { slug, description },
          create: { cityId: city.id, name, slug, description },
        });
      }
      createdOrUpdated.push(community);
    }
  }
  return createdOrUpdated;
}

// ============== ESCOLAS (com vínculo opcional à Comunidade) ==============
async function upsertSchools(cities) {
  const createdOrUpdated = [];

  for (const [cityName, entries] of Object.entries(SCHOOLS_BY_CITY)) {
    const city = pickCityByName(cities, cityName);
    if (!Array.isArray(entries) || entries.length === 0) continue;

    for (const entry of entries) {
      const isObj = typeof entry === 'object';
      const name = toTitle(isObj ? entry.name : entry);
      const publicId = isObj ? entry.publicId : undefined;
      const address = isObj ? entry.address : undefined;
      const communityName = isObj ? entry.communityName : undefined;
      const slug = slugify(name);

      // Se foi passado communityName, tenta achar a comunidade na mesma cidade
      let community = null;
      if (communityName) {
        community = await prisma.community.findUnique({
          where: { cityId_name: { cityId: city.id, name: toTitle(communityName) } },
          select: { id: true },
        });
        if (!community) {
          // Se quiser criar automaticamente a comunidade caso não exista, descomente:
          // community = await prisma.community.create({
          //   data: { cityId: city.id, name: toTitle(communityName), slug: slugify(communityName) },
          // });
          // Ou mantém null silenciosamente:
          console.warn(`⚠️ Comunidade "${communityName}" não encontrada em ${cityName}; escola "${name}" ficará sem vínculo de comunidade.`);
        }
      }

      let school;
      if (publicId) {
        school = await prisma.school.upsert({
          where: { publicId },
          update: { name, slug, address, cityId: city.id, communityId: community?.id ?? null },
          create: { publicId, name, slug, address, cityId: city.id, communityId: community?.id ?? null },
        });
      } else {
        // unique composto @@unique([cityId, name])
        school = await prisma.school.upsert({
          where: { cityId_name: { cityId: city.id, name } },
          update: { slug, address, communityId: community?.id ?? null },
          create: { cityId: city.id, name, slug, address, communityId: community?.id ?? null },
        });
      }
      createdOrUpdated.push(school);
    }
  }

  return createdOrUpdated;
}

// ============== RUNNER ==============
async function main() {
  console.log('🌱 Seeding…');

  const [users, campaigns, cities] = await Promise.all([
    upsertUsers(),
    upsertCampaigns(),
    upsertCities(),
  ]);

  const [communities, schools] = await Promise.all([
    upsertCommunities(cities),
    upsertSchools(cities),
  ]);

  console.log('✅ Seed finalizado.');
  console.log('   - Usuários: admin@amigosdeminas.org / Admin@123');
  console.log('   - Campanhas:', campaigns.map(c => c.slug).join(', '));
  console.log('   - Cidades:', cities.map(c => `${c.name}/${c.state ?? ''}`).join(', '));
  console.log(`   - Comunidades criadas/atualizadas: ${communities.length}`);
  console.log(`   - Escolas criadas/atualizadas: ${schools.length}`);
  console.log(`   - Uploads em: ${path.join(process.cwd(), UPLOAD_DIR)}`);
}

main()
  .catch(err => {
    console.error('❌ Seed falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
