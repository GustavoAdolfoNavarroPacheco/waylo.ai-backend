# Waylo Backend

API de Waylo para cuentas, sesiones, consentimiento, perfiles y acceso server-to-server a la IPS. El adaptador normaliza paciente, catálogo, disponibilidad y citas; las escrituras de citas solo se ejecutan como tools confirmadas desde el chat privado.

> **Estado: Fase 0.** Cuentas, consentimiento, vínculo con la IPS y perfil fusionado están operativos. Chat, voz, triage, hospitales y calendario no forman parte de las rutas REST implementadas actualmente.

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 24 + TypeScript `strict` |
| HTTP | Fastify 5 + Zod |
| Datos | PostgreSQL 16 + pgvector (Prisma 6) |
| Tests | Vitest |
| Docs | OpenAPI 3.1 + Swagger UI (`/docs`) |
| Despliegue | Docker Compose + Caddy (HTTPS) |

## Requisitos

- Docker y Docker Compose (recomendado), o Node.js 24 + PostgreSQL 16 para desarrollo local.
- Puertos libres: `3001` (API) y `5434` (PostgreSQL, solo localhost).

## Inicio rápido (Docker)

```bash
cp .env.example .env        # completa secretos y POSTGRES_PASSWORD
docker compose up -d --build

# catálogo de IPS: mock activo (código de activación 123456)
docker compose exec api node dist/seed/ips.js

curl http://localhost:3001/health
```

- API: `http://localhost:3001`
- Swagger UI: `http://localhost:3001/docs`
- Contrato en JSON: `http://localhost:3001/docs/json`

La imagen ejecuta `prisma migrate deploy` al arrancar. `db` y `api` se publican solo en localhost; el tráfico público entra por Caddy (`--profile https`).

## Desarrollo local

```bash
npm ci
cp .env.example .env        # DATABASE_URL apuntando a tu PostgreSQL
npx prisma migrate deploy
npm run seed:ips
npm run dev                 # recarga en caliente con tsx
```

Guía ampliada (backend + frontend + verificación): [`TESTING_SETUP.md`](./TESTING_SETUP.md).

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `NODE_ENV` | no | `development` \| `test` \| `production` |
| `PORT` | no | Puerto del API (default `3001`) |
| `DATABASE_URL` | **sí** | Cadena de conexión a PostgreSQL |
| `APP_SECRET` | **sí** | ≥32 caracteres; HMAC de seudónimos (consentimientos, auditoría) |
| `IPS_TOKEN_KEY` | **sí** | 64 hex (32 bytes); AES-256-GCM de los tokens de la IPS |
| `SESSION_TTL_DAYS` | no | Duración de la sesión web (default `30`) |
| `CONFIANZA_BASE_URL` | para la integración | URL pública del backend de Confianza; el adaptador compone `/api/v1` |
| `CONFIANZA_AGENT_KEY` | para la integración | Debe igualar `AGENT_API_KEY` en Confianza |
| `CONFIANZA_ENABLED` | para el seed | `true` registra Confianza como IPS activa |
| `WAYLO_INTERNAL_KEY` | para el BFF | Secreto compartido con `waylo.ai`; protege `/internal/ips/*` |
| `XAI_API_KEY` | no | API key del LLM (fase 1) |
| `LLM_BASE_URL` | no | Endpoint compatible con OpenAI (fase 1) |
| `EMERGENCY_PHONE` | no | Número de emergencias del país |
| `MENTAL_HEALTH_PHONE` | no | Línea de salud mental del país |
| `VOICE_BUDGET_MONTHLY_USD` | no | Tope mensual de voz; al agotarse degrada a texto |
| `POSTGRES_PASSWORD` | **sí** (compose) | Contraseña de la base de datos |
| `WAYLO_DOMAIN` | **sí** (HTTPS) | Dominio público para Caddy |
| `DB_PORT` / `API_PORT` | no | Puertos publicados en localhost (default `5434` / `3001`) |

Los secretos se generan con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Endpoints

| Método | Ruta | Estado | Descripción |
|---|---|---|---|
| `GET` | `/health` | ✅ | Estado del servicio |
| `POST` | `/auth/register` | ✅ | Alta de cuenta + sesión |
| `POST` | `/auth/login` | ✅ | Inicio de sesión |
| `POST` | `/auth/logout` | ✅ | Cierre de sesión |
| `DELETE` | `/auth/account` | ✅ | Baja total (devuelve las citas que quedan en la IPS) |
| `POST` | `/consent` | ✅ | Consentimiento informado (Ley 1581) |
| `GET` | `/ips/link` | ✅ | Estado del vínculo con la IPS |
| `POST` | `/ips/link` | ✅ | Vincular con documento + código de activación |
| `DELETE` | `/ips/link` | ✅ | Desvincular |
| `GET` | `/me` | ✅ | Perfil fusionado local ↔ IPS (`source` por campo) |
| `GET/POST/DELETE` | `/internal/ips/link` | ✅ | Estado, alta y baja de vínculo server-to-server |
| `GET` | `/internal/ips/patient` | ✅ | Paciente normalizado para la identidad externa |
| `GET` | `/internal/ips/appointments` | ✅ | Citas normalizadas para lectura |
| `POST` | `/internal/chat/completion` | ✅ | Comunicación privada con el proveedor LLM |

El contrato canónico es [`docs/waylo-api.openapi.yaml`](./docs/waylo-api.openapi.yaml); describe las rutas que registra Fastify. `/docs` y `/docs/json` lo sirven tal cual. El servidor OpenAPI es relativo, por lo que “Try it out” usa el mismo origen desde el que se abrió Swagger, tanto en local como en Vercel. Detalles de seguridad, parámetros, esquemas, ejemplos y errores: [`docs/002-swagger-openapi-prd.md`](./docs/002-swagger-openapi-prd.md).

El contrato entre Waylo y una IPS está en [`IPS_CONTRATO_MINIMO.md`](./IPS_CONTRATO_MINIMO.md). Su implementación y las brechas actuales de Confianza están documentadas en [`docs/006-ips-contract-completion-prd.md`](./docs/006-ips-contract-completion-prd.md).

### Adaptador ciudadano para Waylo

El frontend ciudadano no llama directamente a este servicio. Su Route Handler server-side funciona como BFF y usa `WAYLO_INTERNAL_KEY` para consultar estas rutas privadas:

- `GET/POST/DELETE /internal/ips/link`: consultar, crear o eliminar el vínculo por `external_subject`.
- `GET /internal/ips/patient`: obtener el perfil mínimo disponible en la IPS.
- `GET /internal/ips/appointments`: obtener las citas actuales.
- `POST /internal/chat/completion`: ejecutar function calling de citas. Crear, cancelar y reprogramar exigen confirmación explícita y no se exponen como rutas REST independientes.

El chat usa `POST /internal/chat/completion` con la misma clave interna. La ruta
reenvía la solicitud a Reto, ejecuta las tools de citas cuando recibe un sujeto de
sesión y no persiste mensajes. Las reglas de triage continúan en `waylo.ai`.

El backend cifra el token devuelto por Confianza, no persiste el código de activación ni la cédula, y marca el vínculo como inválido cuando la IPS rechaza el token. El detalle del contrato y la secuencia completa están en [`docs/001-ips-integration-mvp-prd.md`](./docs/001-ips-integration-mvp-prd.md).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor en desarrollo con recarga |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Ejecuta `dist/server.js` |
| `npm run typecheck` | Typecheck estricto sin emitir |
| `npm test` | Tests con Vitest |
| `npm run migrate:deploy` | Aplica migraciones |
| `npm run seed:ips` | Registra las IPS por defecto (mock activo) |
| `npm run prisma:generate` | Regenera el cliente Prisma |

## Tests

```bash
# los tests de integración usan una BD de pruebas, nunca la de desarrollo
DATABASE_URL="postgresql://waylo:<password>@127.0.0.1:5434/waylo_test" npm test
```

Cubren autenticación y baja, consentimiento, vínculo con la IPS (mock), criptografía y el contrato servido en `/docs`.

## Estructura

```
src/
  app.ts              # Fastify, errores, Swagger y registro de módulos
  config.ts           # validación del entorno con Zod
  errors.ts           # códigos de error del contrato
  lib/                # Prisma, contraseñas, criptografía
  modules/            # auth · consent · ips · me · health
  seed/               # catálogo de IPS
prisma/               # schema y migraciones
docs/                 # contrato OpenAPI (fuente de verdad)
test/                 # tests de integración
```

## Seguridad

- Contraseñas con `scrypt`; sesiones opacas: la base solo guarda el hash SHA-256 del token.
- Cookie `waylo_session` `httpOnly`, `SameSite=Lax` y `Secure` en producción.
- Tokens de la IPS cifrados con AES-256-GCM; seudónimos de consentimiento con HMAC.
- La baja de cuenta borra todo lo local; el consentimiento se conserva seudonimizado como prueba.
- Waylo no es el sistema maestro ni editable de la historia clínica. Conserva solo una caché
  cifrada, de solo lectura y con TTL máximo de siete días, para degradar consultas IPS sin escritura.
- Sin recuperación de contraseña ni verificación de email en el MVP (riesgo aceptado).

## Despliegue

Pasos, variables de producción, backups y rollback en [`deploy.md`](./deploy.md).

---

## Ecosistema

La memoria clínica híbrida está documentada en [`docs/007-clinical-memory.md`](./docs/007-clinical-memory.md):
este repositorio conserva únicamente el contexto IPS cifrado y temporal; la memoria propia
confirmada por el paciente pertenece a `waylo.ai`.

| Repo | Descripción |
|---|---|
| [waylo.ai-backend](https://github.com/GustavoAdolfoNavarroPacheco/waylo.ai-backend) | Este repositorio: API canónica |
| [waylo.ai](https://github.com/GustavoAdolfoNavarroPacheco/waylo.ai) | Frontend Next.js (chat, voz, cuenta) |
| [confianza-ips-frontend](https://github.com/Duran24062005/confianza-ips-frontend) | Confianza IPS: la IPS de integración |

El contrato compartido entre frontend y backend es [`docs/waylo-api.openapi.yaml`](./docs/waylo-api.openapi.yaml). Documentación de producto y alcance: [`WAYLO_BACKEND.md`](./WAYLO_BACKEND.md) e [`WAYLO_IMPLEMENTACION.md`](./WAYLO_IMPLEMENTACION.md).
