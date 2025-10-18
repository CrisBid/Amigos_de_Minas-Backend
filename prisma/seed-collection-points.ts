import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const points = [
    {
      name: 'Pampulha e Região',
      slug: 'pampulha-regiao',
      description: 'Ponto de coleta da região da Pampulha',
      address: 'Avenida Deputado Anuar Menhem, 341',
      district: 'Santa Amélia',
      cityName: 'Belo Horizonte',
      state: 'MG',
      phone: '(31) 99257-4338',
      responsibleUserId: null, // sem responsável ainda
      active: true,
    },
    {
      name: 'Região Leste',
      slug: 'regiao-leste',
      description: 'Ponto de coleta da Região Leste de BH',
      address: 'Rua Coronel Fulgêncio, 373, Santa Efigênia, Apto. 215',
      cityName: 'Belo Horizonte',
      state: 'MG',
      phone: '(31) 98597-7855',
      responsibleUserId: 'cmgps8eo9005k29qkkyt71dch', // Jennifer Cardoso
      active: true,
    },
    {
      name: 'Região Nordeste',
      slug: 'regiao-nordeste',
      description: 'Ponto de coleta da Região Nordeste de BH',
      address: 'Av. José Cândido da Silveira, 311, Apto. 101, Cidade Nova',
      cityName: 'Belo Horizonte',
      state: 'MG',
      phone: '(31) 99179-3651',
      responsibleUserId: 'cmgste86y000029li901nh7lc', // Dionice C Pereira
      active: true,
    },
    {
      name: 'Região Central/Centro-Sul',
      slug: 'regiao-central-centro-sul',
      description: 'Ponto de coleta da Região Central / Centro-Sul',
      address: 'Rua Irídio, 151, Apto. 103, Grajaú',
      cityName: 'Belo Horizonte',
      state: 'MG',
      phone: '(31) 99681-3126',
      responsibleUserId: null,
      active: true,
    },
    {
      name: 'Região Sudoeste',
      slug: 'regiao-sudoeste',
      description: 'Ponto de coleta da Região Sudoeste',
      address: 'Rua Castor, 308, Barreiro',
      cityName: 'Belo Horizonte',
      state: 'MG',
      phone: '(31) 98517-7035',
      responsibleUserId: null,
      active: true,
    },
    {
      name: 'Ribeirão das Neves',
      slug: 'ribeirao-das-neves',
      description: 'Ponto de coleta de Ribeirão das Neves',
      address: 'Rua José Maria de Alkimim, 22, sala 02, São Pedro',
      cityName: 'Ribeirão das Neves',
      state: 'MG',
      phone: '(31) 99232-3264',
      responsibleUserId: null,
      active: true,
    },
    {
      name: 'Brumadinho',
      slug: 'brumadinho',
      description: 'Ponto de coleta de Brumadinho',
      address: 'Rua Sidney Pinto, 190, Conceição de Itaguaá',
      cityName: 'Brumadinho',
      state: 'MG',
      phone: '(31) 99715-5272',
      responsibleUserId: null,
      active: true,
    },
  ]

  for (const p of points) {
    await prisma.collectionPoint.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    })
  }

  console.log('✅ Pontos de coleta inseridos com sucesso!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
