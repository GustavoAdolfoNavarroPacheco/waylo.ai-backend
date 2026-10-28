# Despliegue — VPS + Docker Compose

> Para una función HTTP en Vercel, consulta [`docs/vercel-deployment.md`](docs/vercel-deployment.md).
> El VPS sigue siendo el despliegue canónico para procesos persistentes y WebSocket.

## Servicios

| servicio | imagen | expuesto |
|----------|--------|----------|
| `db` | `pgvector/pgvector:pg16` | solo red interna |
| `api` | build del repo (Dockerfile) | solo red interna (3001) |
| `caddy` | `caddy:2` | **80/443 públicos** — HTTPS automático (Let's Encrypt) |

El backend corre las migraciones solo al arrancar (`prisma migrate deploy`). La imagen de `db` trae pgvector → en prod se crea `rag_chunks` completo (el guard DO es solo para dev local sin pgvector).

## Pasos en el VPS

```bash
git clone <repo-url> waylo && cd waylo

# .env con los valores reales (ver tabla de abajo): POSTGRES_PASSWORD, APP_SECRET,
# IPS_TOKEN_KEY y WAYLO_DOMAIN son obligatorias
chmod 600 .env

docker compose --profile https up -d --build   # db + api + caddy (HTTPS)

# primer arranque: registrar el catálogo de IPS (mock activo + confianza inactivo)
docker compose exec api node dist/seed/ips.js

# verificar
docker compose ps            # api → healthy
curl https://<tu-dominio>/health   # {"status":"ok"}
# Swagger UI: https://<tu-dominio>/docs  (contrato interno; JSON en /docs/json)
docker compose logs -f api   # migraciones + arranque
```

Sin `--profile https` solo levantan `db` + `api` (así se prueba en local: `http://localhost:3001`). `db` y `api` están publicados solo en **localhost** (`5434` y `3001`) para debug y backups.

## Variables del `.env` (producción)

| variable | obligatoria | nota |
|----------|-------------|------|
| `WAYLO_DOMAIN` | sí | dominio del API (Caddy hace el HTTPS) |
| `POSTGRES_PASSWORD` | sí | solo alfanumeríticos (va dentro de `DATABASE_URL`) |
| `APP_SECRET` | sí | ≥32 chars → `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `IPS_TOKEN_KEY` | sí | 64 hex (AES-256-GCM), mismo comando |
| `CONFIANZA_BASE_URL` / `CONFIANZA_AGENT_KEY` | sí para el vínculo IPS | URL pública y clave igual a `AGENT_API_KEY` en Confianza |
| `WAYLO_INTERNAL_KEY` | sí para el BFF | Igual a `WAYLO_BACKEND_KEY` del frontend ciudadano |
| `CONFIANZA_ENABLED` | sí para el seed IPS | `true` antes de ejecutar `npm run seed:ips` |
| `XAI_API_KEY` / `LLM_BASE_URL` | no | Grok (Fase 1) |
| `EMERGENCY_PHONE` / `MENTAL_HEALTH_PHONE` | no | números por país |
| `VOICE_BUDGET_MONTHLY_USD` | no | default 10 |

## Backups (obligatorio: dato de salud)

```bash
crontab -e
# dump diario 03:00
0 3 * * * cd /ruta/waylo && docker compose exec -T db pg_dump -U waylo waylo | gzip > /var/backups/waylo-$(date +\%F).sql.gz
```

Restaurar: `gunzip -c backup.sql.gz | docker compose exec -T db psql -U waylo -d waylo`

## Actualizar / rollback

```bash
git pull && docker compose up -d --build     # actualizar (migras solas)
git checkout <tag> && docker compose up -d --build   # rollback de código
```

## Notas de seguridad

- Los secretos viven **solo en el `.env` del VPS** (permiso 600); nunca entran en la imagen (`.dockerignore` excluye `.env`).
- La BD no tiene puertos públicos; solo `api` (vía Caddy) la alcanza.
- Sin `docker compose down` salvo mantenimiento: `down` borra el volumen `pgdata` si no está declarado… está declarado ✓, pero haz dump antes de tocar volúmenes.
