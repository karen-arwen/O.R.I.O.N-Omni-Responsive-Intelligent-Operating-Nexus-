# O.R.I.O.N — Stark OS (Jarvis Mode)

Painel Stark para operar o O.R.I.O.N: observabilidade total de decisoes, timeline sanitizada e centro de automacao local-first.

## Stack
- Node.js 20 + TypeScript (monorepo npm workspaces)
- Fastify API com Event Store append-only + Audit + Planner + PermissionEngine + Trust
- Next.js 13 (app router) + Tailwind + React Query + framer-motion + cmdk
- Testes: Vitest (unit/contrato) + Playwright (smoke web)

## Como rodar
- Copie `.env.example` para `.env` e ajuste portas/origens.
- Dependencias: `npm install`
- API (porta 3000): `npm run dev:api`
- Web (porta 3001, espera API em `NEXT_PUBLIC_ORION_API_BASE_URL`): `npm run dev:web`
- Verificacao completa (lint + typecheck + tests + build web): `npm run verify`

## Endpoints principais (API)
- `GET /health` — status ok, uptime, version
- `GET /metrics` — contadores por rota (requests, errors, p95/p99)
- `POST /events` / `GET /events`
- `GET /audit`
- `POST /permissions/evaluate`
- `POST /planner/decide`
- `GET /decisions/:decisionId/snapshot` (ETag forte, 304)
- `POST /decisions/:decisionId/feedback` (XOR accepted/rejected, idempotente)
- `GET /timeline` (cursor base64url, ordem ts asc + id, payload sanitizado)
- `GET /trust` e `GET /trust/:domain`

## Hardening & Observability
- Logger estruturado do Fastify (requestId, correlationId em header)
- Envelope padrao `{ error: { code, message, details?, requestId } }` para erros
- Rate limit por IP+rota (ORION_RATE_LIMIT/ORION_RATE_WINDOW_MS)
- CORS configuravel (ORION_ALLOWED_ORIGINS) + headers de seguranca
- Env validation no boot (`ORION_API_PORT`, `ORION_STORAGE_PATH`, etc.)
- Health/metrics expostos para smoke/uptime checks
- Multi-tenant v0: header `x-tenant-id` (regex `^[a-z0-9_-]{1,32}$`, default `local`) propaga em meta dos eventos e filtros do Event Store.
- Auth v0: `ORION_DEV_AUTH_BYPASS=true` (dev) ou Bearer tokens em `ORION_AUTH_TOKENS`. Roles default em `ORION_AUTH_DEFAULT_ROLES`. RBAC: timeline/decisions -> member/admin; trust/metrics -> admin; health -> público.

## Design System (web)
- Tokens em `apps/web/lib/theme/tokens.ts` (spacing, radius, shadows, gradients)
- Componentes base: Button, Card, Badge, Tooltip, Dialog, Toast, Skeleton
- Glass/glow utilities, fonte Space Grotesk, AppShell com banner offline global
- Error boundary global (`app/error.tsx`) com reset seguro

## Jarvis Mode Features
- `/mission` — Command Center (Live toggle, Trust radar). Teste: abrir rota, verificar cards de live/timeline.
- `/alerts` — Alert Center v2. Teste: abrir rota, ver lista de alertas deduplicados.
- `/replay/[decisionId]` — Decision Replay animado (timeline sanitizada). Teste: navegar com decisionId real e checar playback.
- `/automations` — Automation Studio local-only. Teste: validar UI no-code sem chamadas externas.
- `/policies` — Policy Inspector read-only. Teste: navegar e inspecionar policies carregadas.
- `/timeline` — Timeline PRO virtualizada + filtros + export trace. Teste: aplicar filtro (corr/dec/domain), scroll para carregar mais, exportar view.
- `/decisions/[id]` — Decision Detail Ultra (ETag awareness + explain deterministico + export bundle).
- `/mission` + HUD/Command Console (Ctrl+K) funcionam com atalhos de teclado. Teste: `Ctrl/Cmd+K` abre palette; HUD toggle no topo.
- Screenshots esperados: overview com KPIs, timeline filtrada com cards sanitizados, detalhe da decisao com snapshot/feedback e badges de trust.

## Testes
- Unit/contrato (Vitest): `npm test`
  - Inclui contratos de timeline cursor, feedback XOR, snapshot ETag, rate-limit.
- E2E smoke (Playwright, mockando API via route intercept): `npm run test:e2e`
  - Cobre /, /timeline (filtro + scroll), palette Ctrl+K, /mission, /alerts, /decisions/[id].

## Runbook do dev
- Configure `.env` (API + WEB) e garanta `NEXT_PUBLIC_ORION_API_BASE_URL` apontando para a API.
- Start: `npm run dev:api` em um terminal e `npm run dev:web` em outro.
- Observabilidade rapida: `curl http://localhost:3000/health` e `curl http://localhost:3000/metrics`.
- Dados: Event Store JSON em `ORION_STORAGE_PATH` (padrao `data/events.json`). Use endpoints POST /events ou Planner para gerar trafego.
- Docker dev: `docker compose -f docker-compose.dev.yml up --build` (api:3000, web:3001, volume ./data).
- Auth/Tenant (frontend): configure tenant/token/roles em Settings; API client envia `x-tenant-id` e `Authorization` automaticamente.
- Checklist antes de PR: `npm run verify`; rode `npm run test:e2e` se mexer no front crítico.

## Phase 8   Postgres + Redis
- Infra: `npm run dev:infra` sobe Postgres (5432) + Redis (6379). Use `docker-compose.dev.yml`.
- Migrations: `npm run migrate:api` (usa `apps/api/migrations/*`, registra em `schema_migrations`).
- EventStore: selecione via `ORION_EVENTSTORE_ADAPTER` (`postgres` | `json` | `memory`). Default: postgres se `ORION_DB_URL` set; sen�o JSON.
- Redis: `ORION_REDIS_URL` habilita cache (snapshots/trust) e rate-limit distribu�do (`ORION_RATE_LIMIT_BACKEND=redis`). TTL curto e invalida��o em trust.updated/feedback.
- Auth tokens: mapeie roles/user por token com `ORION_AUTH_TOKEN_ROLES_<token>` e `ORION_AUTH_TOKEN_USER_<token>`.
- Env principais: `ORION_DB_URL`, `ORION_REDIS_URL`, `ORION_CACHE_ENABLED`, `ORION_RATE_LIMIT_BACKEND`, `ORION_TENANT_WHITELIST`, `NEXT_PUBLIC_ORION_API_BASE_URL`.
- Testes: unit `npm test`, integra��o (usa pg/redis reais ou pula sem URLs) `npm run test:integration`, web build `npm run build:web`.
