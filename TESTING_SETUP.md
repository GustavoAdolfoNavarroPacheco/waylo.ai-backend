# Guía de levantamiento local

Cómo levantar el stack completo de Waylo (backend, base de datos y frontend) para probar en el navegador.

## 1. Servicios y puertos

| Servicio | Tecnología | URL / puerto | Función |
|---|---|---|---|
| Base de datos | Docker (`pgvector/pgvector:pg16`) | `127.0.0.1:5434` | PostgreSQL con extensión pgvector |
| Backend API | Fastify + Node 24 (Docker o local) | `http://localhost:3001` | API canónica, auth, IPS |
| Swagger UI | `@fastify/swagger-ui` | `http://localhost:3001/docs` | Consola interactiva del contrato |
| Frontend | Next.js (Turbopack) | `http://localhost:3000` | Landing, chat, voz y cuenta |

`db` y `api` solo se publican en localhost; en el VPS el tráfico público entra por Caddy (ver `deploy.md`).

## 2. Variables de entorno

### Backend (`waylo.ai-backend/.env`)

Copia `.env.example` y completa los valores. Los secretos **no se versionan**.

```bash
NODE_ENV=development
PORT=3001

# Postgres del compose
DATABASE_URL="postgresql://waylo:<POSTGRES_PASSWORD>@127.0.0.1:5434/waylo"
POSTGRES_PASSWORD=<contraseña>

# Secretos (64 caracteres hex)
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_SECRET=<hex de 64>
IPS_TOKEN_KEY=<hex de 64>

# Sesión
SESSION_TTL_DAYS=30

# IPS Confianza
CONFIANZA_BASE_URL=<url de la IPS>
CONFIANZA_AGENT_KEY=<opcional>

# LLM (fase 1)
XAI_API_KEY=<api key>
LLM_BASE_URL=<base url compatible con OpenAI>
LLM_MODEL=<modelo, p. ej. grok-4.6>

# Números de emergencia por país
EMERGENCY_PHONE=<número>
MENTAL_HEALTH_PHONE=<número>
VOICE_BUDGET_MONTHLY_USD=10
```

### Frontend ([waylo.ai](https://github.com/GustavoAdolfoNavarroPacheco/waylo.ai))

El frontend gestiona sus propias variables (proveedor de LLM, conexión a su base de datos y secreto de sesión). Consúltalas en el README de ese repositorio; ninguna debe compartirse con el backend salvo la URL del API.

## 3. Pasos

### Paso 1: base de datos y backend

```bash
cd waylo.ai-backend
docker compose up -d

# Catálogo de IPS (primera vez o tras recrear el volumen)
docker compose exec api node dist/seed/ips.js
```

### Paso 2: frontend

```bash
git clone https://github.com/GustavoAdolfoNavarroPacheco/waylo.ai
cd waylo.ai
npm install
npm run dev
```

## 4. Verificación rápida

```bash
curl -i http://localhost:3001/health          # 200 {"status":"ok"}
curl -i http://localhost:3001/docs            # 200 Swagger UI
curl -i http://localhost:3001/docs/json       # 200 contrato OpenAPI
curl -i http://localhost:3000                 # 200 frontend
```

Con el frontend levantado, el recorrido mínimo es: registro → consentimiento → vincular IPS (código mock `123456`) → `/me` → logout → baja de cuenta.

## 5. URLs

- App: `http://localhost:3000`
- Documentación del API: `http://localhost:3001/docs`

## 6. Diagnóstico

```bash
docker compose ps                 # estado de los contenedores
docker compose logs -f api        # migraciones + arranque
docker compose up -d --no-deps api  # recrear el backend tras cambiar variables
npm test                          # tests del backend (requiere BASE de pruebas)
```

Los tests de integración necesitan una base de datos **de pruebas** (`waylo_test`) y la variable `DATABASE_URL` apuntando a ella; nunca se ejecutan contra la base de desarrollo.
