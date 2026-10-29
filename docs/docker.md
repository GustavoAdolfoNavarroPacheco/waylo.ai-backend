# Docker: backend Waylo

Este repositorio ya incluye `Dockerfile`, `.dockerignore` y `docker-compose.yml`.
La imagen compila TypeScript, genera el cliente Prisma y ejecuta las migraciones
antes de iniciar el servidor en el puerto `3001`.

## Ejecución recomendada

```bash
docker compose up -d --build
docker compose logs -f api
```

El servicio `db` usa PostgreSQL 16 con `pgvector` y solo publica el puerto en
`127.0.0.1`. El servicio `api` queda en la red interna de Compose; Caddy es
opcional para exponer HTTPS en un VPS.

Las variables de integración (`WAYLO_INTERNAL_KEY`, `CONFIANZA_AGENT_KEY` y
`CONFIANZA_ENABLED`) deben configurarse mediante `.env` sin versionarlo. El seed
de IPS se ejecuta explícitamente con `npm run seed:ips` cuando corresponda.
