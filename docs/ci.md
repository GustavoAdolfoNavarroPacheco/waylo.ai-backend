# Integración continua

## Propósito

El workflow `.github/workflows/ci.yml` valida el backend en cada `push` y en
cada `pull_request` dirigido a `main`. La validación busca detectar errores de
dependencias, esquema, tipos, pruebas y compilación antes de integrar cambios.

## Flujo ejecutado

El job usa `ubuntu-latest`, Node.js 24 y una instancia temporal de PostgreSQL
16. El orden es deliberado:

1. instala exactamente `package-lock.json` con `npm ci`;
2. genera el cliente de Prisma;
3. aplica las migraciones en la base temporal del runner;
4. ejecuta el análisis de tipos;
5. ejecuta toda la suite de Vitest;
6. compila el backend.

La base de datos del servicio solo existe durante el job. Las pruebas no usan
Neon ni una base de datos compartida.

## Variables de prueba

El workflow define valores sintéticos para que la aplicación pueda cargar su
configuración:

- `DATABASE_URL` apunta al servicio PostgreSQL del runner.
- `APP_SECRET` cumple el mínimo de 32 caracteres.
- `IPS_TOKEN_KEY` contiene 64 caracteres hexadecimales.
- `CONFIANZA_AGENT_KEY`, `XAI_API_KEY` y `LLM_BASE_URL` son valores de prueba;
  no permiten llamadas reales a Confianza IPS ni a xAI.
- Los números de emergencia corresponden a los fixtures del MVP y no son una
  comprobación de disponibilidad telefónica.

No se deben agregar claves reales, URLs de producción ni variables de
Vercel al archivo del workflow.

## Reproducción local

Con Docker disponible, el mismo orden lógico se puede ejecutar apuntando
`DATABASE_URL` a una PostgreSQL local:

```bash
npm ci
npm run prisma:generate
npm run migrate:deploy
npm run typecheck
npm test
npm run build
```

Antes de `migrate:deploy` deben estar definidas `DATABASE_URL`, `APP_SECRET` e
`IPS_TOKEN_KEY`. La base debe ser exclusiva para pruebas, porque los tests
limpian sus propios fixtures.

## Límites de la validación

Un job exitoso confirma la compilación y las pruebas automatizadas del backend.
No confirma:

- conectividad o migraciones de la base Neon de producción;
- credenciales y disponibilidad de xAI;
- disponibilidad de una instancia real de Confianza IPS;
- despliegue, variables o runtime de Vercel;
- comportamiento de WebSocket o procesos persistentes del VPS.

El VPS con Docker Compose continúa siendo el despliegue canónico para esos
casos operativos.
