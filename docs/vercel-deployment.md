# Despliegue HTTP en Vercel

## Propósito

Vercel sirve este backend como una única función Fastify para requests HTTP.
El despliegue VPS + Docker Compose sigue siendo el entorno canónico para el
proceso persistente y futuras conexiones WebSocket.

## Entrada de Vercel

- `src/app.ts` conserva el export nombrado `buildApp` para los tests y el
  arranque local.
- El `default export` de `src/app.ts` es el handler HTTP que Vercel invoca.
- `src/server.ts` sigue siendo el entrypoint local/VPS y mantiene `listen()`.
- `docs/waylo-api.openapi.yaml` se incluye explícitamente porque Swagger lo
  lee en runtime.

## Configuración del proyecto

El proyecto de Vercel debe apuntar a la raíz del repositorio
`waylo.ai-backend`, con framework `Fastify` y Node.js 24.x. No debe apuntar al
frontend `waylo.ai`, a `ConfianzaIPS` ni a otro fork del backend.

Si el proyecto de Vercel está conectado a otro repositorio, estos archivos no
llegarán mediante Git aunque el despliegue aparezca como `READY`.

## Variables requeridas

Configurar en Production y Preview, sin commitearlas:

- `DATABASE_URL`
- `APP_SECRET` (mínimo 32 caracteres)
- `IPS_TOKEN_KEY` (64 caracteres hexadecimales)

Las variables opcionales están documentadas en `deploy.md`.

## Compatibilidad de Swagger UI

`@fastify/swagger-ui` instala `@fastify/static`. Vercel/Node.js 24 puede
resolver una versión de `content-disposition` ESM que `@fastify/static` carga
con `require()`, provocando `ERR_REQUIRE_ESM` al iniciar la función.

El `overrides` de `package.json` fija `@fastify/static@10.1.0`, cuya cadena usa
una versión CommonJS compatible. Mantener `package-lock.json` sincronizado y
no eliminar este override sin validar un Preview.

## Validación local

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Después de desplegar un Preview, comprobar `GET /health` y revisar los logs de
la función. Un despliegue `READY` solo confirma que el artefacto se construyó;
la ruta debe responder para considerar corregido el runtime.
