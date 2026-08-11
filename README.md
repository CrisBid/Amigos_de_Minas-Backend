# Amigos de Minas — Backend

API do sistema de gestão de apadrinhamento da **ONG Amigos de Minas**, responsável por toda a operação de crianças apadrinhadas, padrinhos/madrinhas, campanhas, pontos de coleta e geração das imagens personalizadas usadas nas campanhas.

Construída com **NestJS 11** + **Prisma** sobre **PostgreSQL**, expõe uma API REST consumida pelo [frontend em Next.js](../Amigos_de_Minas-Frontend-master) (área pública de apadrinhamento e painel administrativo).

## Sumário

- [Sobre o projeto](#sobre-o-projeto)
- [Stack técnica](#stack-técnica)
- [Módulos da aplicação](#módulos-da-aplicação)
- [Modelo de dados](#modelo-de-dados)
- [Como rodar localmente](#como-rodar-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Scripts disponíveis](#scripts-disponíveis)
- [Composição de imagens das campanhas](#composição-de-imagens-das-campanhas)
- [Migração de dados legados](#migração-de-dados-legados)
- [Testes](#testes)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Roadmap / pontos de atenção](#roadmap--pontos-de-atenção)

## Sobre o projeto

Este backend foi desenvolvido para dar à equipe da ONG **gestão completa e flexível de toda a operação de apadrinhamento**: cadastro de crianças, cidades, comunidades e escolas, controle do ciclo de vida de cada apadrinhamento (do interesse do padrinho até a entrega do presente), gestão de campanhas sazonais (ex.: Natal) e emissão de relatórios.

Dois pontos de destaque do projeto:

- **Automação da montagem de imagens**: um pipeline de composição de fotos das crianças com as molduras/artes de cada campanha, que antes era feito manualmente (levando semanas) e hoje é gerado em minutos.
- **Compatibilidade com os dados históricos da ONG**: o modelo de dados foi desenhado para aceitar a importação do que já existia em planilhas, preservando o histórico sem exigir retrabalho de recadastro.

## Stack técnica

- **Runtime/Framework**: [NestJS 11](https://nestjs.com/) sobre Express
- **Linguagem**: TypeScript 5.7
- **Banco de dados**: PostgreSQL 16
- **ORM**: [Prisma 6](https://www.prisma.io/) (`@prisma/client`)
- **Autenticação**: JWT (access + refresh token) com `@nestjs/passport` / `passport-jwt`, senhas com `bcrypt`
- **Processamento de imagem**: [`sharp`](https://sharp.pixelplumbing.com/) (composição em camadas, resize, conversão para WebP, máscaras SVG para cantos arredondados, overlay de texto dinâmico)
- **Upload de arquivos**: `multer`
- **Geração de planilhas**: [`exceljs`](https://github.com/exceljs/exceljs) (exportações de crianças e apadrinhamentos)
- **Validação**: `class-validator` / `class-transformer` com `ValidationPipe` global
- **Testes**: Jest + Supertest

## Módulos da aplicação

| Módulo | Responsabilidade |
|---|---|
| `auth` | Registro, login (e-mail ou telefone) e refresh de token JWT |
| `users` | CRUD administrativo de usuários e papéis (roles) |
| `profiles` | Perfil complementar do usuário (endereço, profissão, renda, estado civil) |
| `children` | Cadastro de crianças, filtros, estatísticas, upload de foto, preview dinâmico e importação em massa |
| `child-images` | Versionamento das imagens processadas de cada criança (original / processada / com moldura) |
| `campaigns` | CRUD de campanhas e dos layouts/molduras (`CampaignFrame`) usados na composição |
| `sponsors` | Listagem de padrinhos e madrinhas |
| `sponsorships` | Ciclo de vida do apadrinhamento: criação, transferência, ativação, encerramento |
| `cities` / `communities` / `schools` | Hierarquia geográfica (cidade → comunidade → escola), com soft delete |
| `collection-points` | Pontos físicos de coleta/entrega de doações |
| `exports` / `modules/exports` | Exportação de crianças e de apadrinhamentos para Excel |
| `common` | Guards de autenticação e de papéis, decorator `@Roles()`, serviço de storage |
| `prisma` | Serviço/wrapper injetável do Prisma Client |

## Modelo de dados

Principais entidades (ver [`prisma/schema.prisma`](prisma/schema.prisma)):

- **User** (`ADMIN` / `STAFF` / `SPONSOR`) — com `Profile` 1:1
- **Child** — a criança apadrinhada, vinculada a `City`, `Community` e `School`
- **Sponsorship** — o apadrinhamento em si, ligando `Child` + `User` (padrinho) + `Campaign`, com status logístico (`PENDING → IN_PROGRESS → IN_PURCHASE → PACKED → BOXED → AWAITING_DELIVERY → COMPLETED/ENDED/CANCELLED`) e método (`GIFT` ou `PIX`)
- **Campaign** e **CampaignFrame** — campanhas e seus layouts/molduras de composição de imagem
- **ChildImage** — cada versão de imagem gerada para uma criança em uma campanha (original, processada, com moldura)
- **City / Community / School / CollectionPoint** — estrutura geográfica e logística

O schema mantém deliberadamente campos legados (`Child.cityName`, `Child.schoolLegacy`) ao lado das relações normalizadas, para suportar a transição gradual dos dados que vieram de planilhas.

## Como rodar localmente

Pré-requisitos: Node.js 18+, Yarn e Docker (para o banco de dados).

```bash
# 1. Instalar dependências
yarn install

# 2. Subir o banco PostgreSQL via Docker
docker compose up -d

# 3. Configurar variáveis de ambiente (ver seção abaixo)
cp .env.example .env

# 4. Rodar as migrações do Prisma
yarn prisma migrate deploy

# 5. (Opcional) Popular o banco com dados iniciais (cidades/comunidades/escolas)
yarn db:seed

# 6. Subir a API em modo desenvolvimento
yarn start:dev
```

A API sobe na porta **3050** (fixa em `main.ts`, não configurável por variável de ambiente no momento).

## Variáveis de ambiente

Não há `.env.example` versionado ainda — recomenda-se criar um com as variáveis abaixo, todas lidas diretamente do código:

| Variável | Descrição | Default |
|---|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL | — (obrigatória) |
| `JWT_ACCESS_SECRET` | Segredo do access token | — (obrigatória) |
| `JWT_ACCESS_TTL` | Tempo de vida do access token (segundos) | `3600` |
| `JWT_REFRESH_SECRET` | Segredo do refresh token | — (obrigatória) |
| `JWT_REFRESH_TTL` | Tempo de vida do refresh token (segundos) | `2592000` (30 dias) |
| `FRONTEND_ORIGIN` | Origens permitidas para CORS (separadas por vírgula) | todas, se ausente |
| `UPLOAD_DIR` | Pasta local onde as imagens são armazenadas | `uploads` |
| `API_PUBLIC_URL` | URL pública usada para montar links de arquivos | `http://localhost:3001` |

> Os arquivos enviados ficam disponíveis publicamente em `/uploads` (servidos via `ServeStaticModule`, com cache de 30 dias).

## Scripts disponíveis

| Comando | Descrição |
|---|---|
| `yarn start:dev` | Sobe a API em modo watch |
| `yarn start:prod` | Sobe a API a partir do build (`dist/`) |
| `yarn build` | Compila o projeto |
| `yarn lint` | Lint com autofix (ESLint flat config) |
| `yarn format` | Formata `src` e `test` com Prettier |
| `yarn test` | Testes unitários (Jest) |
| `yarn test:e2e` | Testes end-to-end |
| `yarn test:cov` | Cobertura de testes |
| `yarn db:seed` | Popula o banco com cidades/comunidades/escolas reais da ONG (`prisma/seed.cjs`) |

## Composição de imagens das campanhas

O ponto de maior automação do sistema é o pipeline de geração das imagens personalizadas de cada criança para as campanhas (ex.: card de Natal com foto + moldura + nome + presente desejado):

1. **Upload da foto** (`POST /children/:id/photo`) — recebe a foto original, gera uma versão otimizada em **WebP** e, se a campanha tiver uma moldura ativa, já gera a versão final composta.
2. **Composição em camadas** (via `sharp`) — a foto é redimensionada/recortada conforme a configuração do layout (`fit`, `gravity`, `cornerRadius`, `scale`), a moldura é sobreposta, e textos dinâmicos (nome, idade calculada, presente desejado, cidade, comunidade) são renderizados via SVG sobre a imagem.
3. **Preview dinâmico** (`GET /children/:id/render`) — permite pré-visualizar a composição em tempo real (sem persistir), aceitando overrides de layout, textos e recorte via query string — usado pelo painel administrativo para ajustar o layout antes de gerar a versão final.
4. **Versionamento** — cada imagem gerada fica registrada como um `ChildImage`, guardando as URLs do original, do processado e do composto, além do snapshot da configuração usada.

Esse pipeline reduziu um processo que antes era feito manualmente (imagem por imagem, em softwares de edição) — levando semanas por campanha — para um processo de poucos minutos.

## Migração de dados legados

Para acomodar o histórico da ONG, que estava em planilhas, o backend expõe:

- **`POST /children/bulk/commit`** — importação em lote de crianças (upsert por `publicId`), usada para migrar rapidamente os dados já existentes sem exigir recadastro manual.
- **Campos de compatibilidade no schema** (`cityName`, `schoolLegacy`) que convivem com as relações normalizadas (`City`, `School`), permitindo que dados antigos, digitados como texto livre, continuem válidos enquanto a base é normalizada.
- **Seeds com dados reais** (`prisma/seed.cjs`, `prisma/seed-collection-points.ts`) — carregam comunidades, escolas e pontos de coleta já existentes da operação da ONG nas cidades atendidas no Norte de Minas.
- **Exportação para Excel** (`exports/children`, `modules/exports`) — permite que a equipe continue gerando planilhas de acompanhamento a partir dos dados atualizados no sistema, mantendo compatibilidade com o fluxo de trabalho que a ONG já utilizava.

## Testes

```bash
yarn test       # unitários
yarn test:e2e   # end-to-end
yarn test:cov   # cobertura
```

> Estado atual: o projeto ainda conta apenas com os testes gerados por padrão pelo Nest CLI. Ampliar a cobertura de testes de domínio (crianças, apadrinhamentos, composição de imagem) é um próximo passo recomendado.

## Estrutura de pastas

```
src/
├── auth/              # Login, registro e refresh de token
├── users/              # CRUD de usuários e papéis
├── profiles/           # Perfil complementar do usuário
├── children/            # Crianças: CRUD, filtros, estatísticas, fotos
├── child-images/        # Versionamento e composição de imagens
├── campaigns/           # Campanhas e layouts/molduras
├── sponsors/             # Listagem de padrinhos/madrinhas
├── sponsorships/         # Ciclo de vida do apadrinhamento
├── cities/ communities/ schools/   # Hierarquia geográfica
├── collection-points/    # Pontos de coleta/entrega
├── exports/               # Exportação de crianças para Excel
├── modules/exports/         # Exportação de apadrinhamentos para Excel
├── common/                # Guards, decorators, storage
└── prisma/                # Serviço do Prisma Client
prisma/
├── schema.prisma          # Modelo de dados
├── migrations/             # Histórico de migrações
├── seed.cjs                # Seed de cidades/comunidades/escolas
└── seed-collection-points.ts  # Seed de pontos de coleta
```

## Roadmap / pontos de atenção

- Não há documentação automática da API (Swagger/OpenAPI) — endpoints precisam ser consultados diretamente nos controllers.
- A porta da aplicação é fixa (`3050`) no código, não configurável por variável de ambiente.
- Existem duas pastas de exportação (`src/exports/children` e `src/modules/exports`) que podem ser unificadas futuramente.
- Cobertura de testes automatizados ainda é baixa.
