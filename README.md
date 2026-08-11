<div align="center">

# 💙 Amigos de Minas — Backend

### API do sistema de gestão de apadrinhamento da ONG Amigos de Minas

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

*Cadastro de crianças • Campanhas • Apadrinhamentos • Geração automática de imagens • Relatórios*

</div>

---

## 📖 Sumário

- [Sobre o projeto](#-sobre-o-projeto)
- [Stack técnica](#-stack-técnica)
- [Arquitetura em alto nível](#-arquitetura-em-alto-nível)
- [Módulos da aplicação](#-módulos-da-aplicação)
- [Modelo de dados](#-modelo-de-dados)
- [Como rodar localmente](#-como-rodar-localmente)
- [Variáveis de ambiente](#-variáveis-de-ambiente)
- [Scripts disponíveis](#-scripts-disponíveis)
- [🎨 Composição automática de imagens](#-composição-automática-de-imagens)
- [📦 Migração de dados legados](#-migração-de-dados-legados)
- [Testes](#-testes)
- [Estrutura de pastas](#-estrutura-de-pastas)
- [Roadmap / pontos de atenção](#-roadmap--pontos-de-atenção)

---

## 🎯 Sobre o projeto

Este backend nasceu para dar à equipe da **ONG Amigos de Minas** o controle total da operação de apadrinhamento — do primeiro cadastro de uma criança até a entrega do presente na casa dela.

Ele sustenta três frentes principais:

| | |
|---|---|
| 🗂️ **Gestão completa da operação** | Cadastro de crianças, cidades, comunidades e escolas; ciclo de vida do apadrinhamento; campanhas sazonais; relatórios em tempo real. |
| 🎨 **Automação da montagem de imagens** | Pipeline que compõe foto da criança + moldura da campanha + textos dinâmicos automaticamente — processo que levava **semanas** agora leva **minutos**. |
| 📦 **Compatibilidade com o histórico da ONG** | O modelo de dados foi desenhado para importar tudo que já existia em planilhas, sem exigir recadastro manual e sem perder histórico. |

> A prioridade do projeto sempre foi a mesma: **a tecnologia se adapta à ONG — não o contrário.**

---

## 🛠️ Stack técnica

| Categoria | Tecnologia |
|---|---|
| **Framework** | [NestJS 11](https://nestjs.com/) (sobre Express) |
| **Linguagem** | TypeScript 5.7 |
| **Banco de dados** | PostgreSQL 16 |
| **ORM** | [Prisma 6](https://www.prisma.io/) |
| **Autenticação** | JWT (access + refresh) via `@nestjs/passport` / `passport-jwt`, senhas com `bcrypt` |
| **Processamento de imagem** | [`sharp`](https://sharp.pixelplumbing.com/) — composição em camadas, resize, WebP, máscaras SVG, overlay de texto |
| **Upload** | `multer` |
| **Relatórios** | [`exceljs`](https://github.com/exceljs/exceljs) |
| **Validação** | `class-validator` + `class-transformer` (`ValidationPipe` global) |
| **Testes** | Jest + Supertest |

---

## 🏗️ Arquitetura em alto nível

```
┌──────────────────────┐        REST/JSON        ┌──────────────────────────┐
│   Frontend Next.js    │ ───────────────────────▶ │     API NestJS (:3050)   │
│  (público + admin)    │ ◀─────────────────────── │                          │
└──────────────────────┘        JWT Bearer         └────────────┬─────────────┘
                                                                  │
                                   ┌──────────────────────────────┼──────────────────────────────┐
                                   ▼                              ▼                              ▼
                        ┌──────────────────┐         ┌──────────────────────┐        ┌──────────────────────┐
                        │   PostgreSQL 16    │         │   sharp (imagens)     │        │  exceljs (relatórios)  │
                        │  via Prisma Client  │         │  uploads/ (disco)      │        │  exportação .xlsx       │
                        └──────────────────┘         └──────────────────────┘        └──────────────────────┘
```

---

## 🧩 Módulos da aplicação

| Módulo | Responsabilidade |
|---|---|
| 🔐 `auth` | Registro, login (e-mail ou telefone) e refresh de token JWT |
| 👤 `users` | CRUD administrativo de usuários e papéis (roles) |
| 🪪 `profiles` | Perfil complementar do usuário (endereço, profissão, renda, estado civil) |
| 🧒 `children` | Cadastro de crianças, filtros, estatísticas, upload de foto, preview dinâmico e importação em massa |
| 🖼️ `child-images` | Versionamento das imagens processadas de cada criança (original / processada / com moldura) |
| 🎉 `campaigns` | CRUD de campanhas e dos layouts/molduras (`CampaignFrame`) usados na composição |
| 🤝 `sponsors` | Listagem de padrinhos e madrinhas |
| 💝 `sponsorships` | Ciclo de vida do apadrinhamento: criação, transferência, ativação, encerramento |
| 🏙️ `cities` / `communities` / `schools` | Hierarquia geográfica (cidade → comunidade → escola), com soft delete |
| 📍 `collection-points` | Pontos físicos de coleta/entrega de doações |
| 📊 `exports` / `modules/exports` | Exportação de crianças e de apadrinhamentos para Excel |
| 🛡️ `common` | Guards de autenticação e de papéis, decorator `@Roles()`, serviço de storage |
| 🗄️ `prisma` | Serviço/wrapper injetável do Prisma Client |

---

## 🗃️ Modelo de dados

Principais entidades (ver [`prisma/schema.prisma`](prisma/schema.prisma)):

```
User ──1:1── Profile
  │
  └──1:N── Sponsorship ──N:1── Child ──N:1── City
              │                  │             │
              N:1                N:1           └──1:N── Community ──1:N── School
              ▼                  ▼
          Campaign          ChildImage
              │
              └──1:N── CampaignFrame (layouts/molduras)
```

| Entidade | Descrição |
|---|---|
| **User** | `ADMIN` / `STAFF` / `SPONSOR` — com `Profile` 1:1 |
| **Child** | A criança apadrinhada, vinculada a `City`, `Community` e `School` |
| **Sponsorship** | O apadrinhamento em si, ligando `Child` + `User` + `Campaign` |
| **Campaign** / **CampaignFrame** | Campanhas e seus layouts/molduras de composição de imagem |
| **ChildImage** | Cada versão de imagem gerada (original, processada, com moldura) |
| **City / Community / School / CollectionPoint** | Estrutura geográfica e logística |

**Fluxo de status do apadrinhamento:**

```
PENDING → IN_PROGRESS → IN_PURCHASE → PACKED → BOXED → AWAITING_DELIVERY → COMPLETED
                                                                          ↘ ENDED / CANCELLED
```

Método de doação: `GIFT` (presente físico) ou `PIX`.

> O schema mantém deliberadamente campos legados (`Child.cityName`, `Child.schoolLegacy`) ao lado das relações normalizadas, para suportar a transição gradual dos dados que vieram de planilhas.

---

## 🚀 Como rodar localmente

**Pré-requisitos:** Node.js 18+, Yarn e Docker (para o banco de dados).

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

📍 A API sobe na porta **3050** (fixa em `main.ts`, não configurável por variável de ambiente no momento).

---

## 🔑 Variáveis de ambiente

> Não há `.env.example` versionado ainda — recomenda-se criar um com as variáveis abaixo, todas lidas diretamente do código.

| Variável | Descrição | Default |
|---|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL | — *(obrigatória)* |
| `JWT_ACCESS_SECRET` | Segredo do access token | — *(obrigatória)* |
| `JWT_ACCESS_TTL` | Tempo de vida do access token (segundos) | `3600` |
| `JWT_REFRESH_SECRET` | Segredo do refresh token | — *(obrigatória)* |
| `JWT_REFRESH_TTL` | Tempo de vida do refresh token (segundos) | `2592000` (30 dias) |
| `FRONTEND_ORIGIN` | Origens permitidas para CORS (separadas por vírgula) | todas, se ausente |
| `UPLOAD_DIR` | Pasta local onde as imagens são armazenadas | `uploads` |
| `API_PUBLIC_URL` | URL pública usada para montar links de arquivos | `http://localhost:3001` |

> 📁 Os arquivos enviados ficam disponíveis publicamente em `/uploads` (servidos via `ServeStaticModule`, com cache de 30 dias).

---

## 📜 Scripts disponíveis

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

---

## 🎨 Composição automática de imagens

> O ponto de maior automação do sistema. Gera, para cada criança, o card personalizado de campanha (foto + moldura + nome + presente desejado) que antes era montado manualmente, imagem por imagem, em softwares de edição.

```
   📷 Foto original          🖼️ Moldura da campanha        🔤 Textos dinâmicos
        │                          │                             │
        ▼                          ▼                             ▼
  resize / crop            overlay em camada           nome, idade, presente,
  (fit, gravity,             (sharp compositing)         cidade, comunidade
   cornerRadius)                                          (renderizados via SVG)
        └──────────────────────────┬──────────────────────────────┘
                                    ▼
                       🖼️ Imagem final composta (.webp)
                       registrada como ChildImage versionado
```

| Etapa | Como funciona |
|---|---|
| 1️⃣ **Upload da foto** | `POST /children/:id/photo` — recebe a foto original, gera versão otimizada em **WebP** e, se a campanha tiver moldura ativa, já compõe a versão final. |
| 2️⃣ **Composição em camadas** | Via `sharp`: a foto é redimensionada/recortada conforme o layout (`fit`, `gravity`, `cornerRadius`, `scale`), a moldura é sobreposta e textos dinâmicos são renderizados via SVG. |
| 3️⃣ **Preview dinâmico** | `GET /children/:id/render` — pré-visualiza a composição em tempo real, sem persistir, com overrides via query string. Usado pelo admin para ajustar o layout. |
| 4️⃣ **Versionamento** | Cada imagem gerada vira um `ChildImage`, guardando URLs do original, processado e composto + snapshot da configuração usada. |

⏱️ **Resultado:** um processo que levava **semanas por campanha** passou a ser feito em **minutos**.

---

## 📦 Migração de dados legados

> Para acomodar o histórico da ONG — que vivia em planilhas — sem exigir retrabalho da equipe.

| Recurso | O que resolve |
|---|---|
| 📥 `POST /children/bulk/commit` | Importação em lote de crianças (upsert por `publicId`) — migra dados existentes em minutos, sem recadastro manual |
| 🔗 Campos de compatibilidade (`cityName`, `schoolLegacy`) | Convivem com as relações normalizadas (`City`, `School`), aceitando dados antigos digitados como texto livre |
| 🌱 Seeds com dados reais (`seed.cjs`, `seed-collection-points.ts`) | Carregam comunidades, escolas e pontos de coleta já existentes da operação da ONG no Norte de Minas |
| 📤 Exportação para Excel (`exports/children`, `modules/exports`) | Mantém o fluxo de planilhas de acompanhamento que a equipe já usava, agora alimentado pelos dados do sistema |

---

## ✅ Testes

```bash
yarn test       # unitários
yarn test:e2e   # end-to-end
yarn test:cov   # cobertura
```

> ⚠️ Estado atual: o projeto ainda conta apenas com os testes gerados por padrão pelo Nest CLI. Ampliar a cobertura de testes de domínio (crianças, apadrinhamentos, composição de imagem) é um próximo passo recomendado.

---

## 📁 Estrutura de pastas

```
src/
├── auth/                    # Login, registro e refresh de token
├── users/                   # CRUD de usuários e papéis
├── profiles/                # Perfil complementar do usuário
├── children/                # Crianças: CRUD, filtros, estatísticas, fotos
├── child-images/            # Versionamento e composição de imagens
├── campaigns/                # Campanhas e layouts/molduras
├── sponsors/                  # Listagem de padrinhos/madrinhas
├── sponsorships/               # Ciclo de vida do apadrinhamento
├── cities/ communities/ schools/  # Hierarquia geográfica
├── collection-points/           # Pontos de coleta/entrega
├── exports/                       # Exportação de crianças para Excel
├── modules/exports/                # Exportação de apadrinhamentos para Excel
├── common/                          # Guards, decorators, storage
└── prisma/                           # Serviço do Prisma Client

prisma/
├── schema.prisma              # Modelo de dados
├── migrations/                 # Histórico de migrações
├── seed.cjs                     # Seed de cidades/comunidades/escolas
└── seed-collection-points.ts     # Seed de pontos de coleta
```

---

## 🧭 Roadmap / pontos de atenção

- [ ] Documentação automática da API (Swagger/OpenAPI) — hoje os endpoints precisam ser consultados direto nos controllers.
- [ ] Tornar a porta da aplicação configurável por variável de ambiente (hoje fixa em `3050`).
- [ ] Unificar as duas pastas de exportação (`src/exports/children` e `src/modules/exports`).
- [ ] Ampliar a cobertura de testes automatizados.

---

<div align="center">

Feito com 💙 para a **ONG Amigos de Minas**

</div>
