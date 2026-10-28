# Configuración de producción para el vínculo IPS

**Fecha:** 2026-10-28
**Repositorio:** `waylo.ai-backend`

## Flujo

El BFF de `waylo.ai` llama a las rutas privadas `/internal/ips/*` con
`X-Waylo-Internal-Key`. El adaptador intercambia la cédula, EPS y código de seis
dígitos con Confianza mediante `X-Confianza-Agent-Key`, cifra el token recibido y
devuelve únicamente el estado del vínculo.

## Variables requeridas

Configurar en Production y Preview, sin registrar valores en Git ni logs:

| Variable | Propietario | Regla |
|---|---|---|
| `DATABASE_URL` | Waylo backend | PostgreSQL accesible y con migraciones aplicadas |
| `APP_SECRET` | Waylo backend | mínimo 32 caracteres |
| `IPS_TOKEN_KEY` | Waylo backend | exactamente 64 caracteres hexadecimales |
| `CONFIANZA_BASE_URL` | Waylo backend | origen `https://confianza-ips-backend.vercel.app`; el adaptador añade `/api/v1` |
| `CONFIANZA_AGENT_KEY` | Waylo backend | mismo valor que `AGENT_API_KEY` en Confianza |
| `WAYLO_INTERNAL_KEY` | Waylo backend | mínimo 32 caracteres; debe igualar `WAYLO_BACKEND_KEY` del BFF |
| `CONFIANZA_ENABLED` | seed/operación | `true` al registrar Confianza como IPS activa |

El frontend ciudadano debe tener `WAYLO_BACKEND_URL` y `WAYLO_BACKEND_KEY` como
variables server-only. No se deben convertir en `NEXT_PUBLIC_*`.

## Operación de base de datos

Después de aplicar migraciones, ejecutar el seed en un entorno controlado con
`CONFIANZA_ENABLED=true` y comprobar que `ips.slug=confianza` esté activa. El
`buildCommand` de Vercel genera Prisma y compila; no debe asumirse que crea esa fila
ni que aplica migraciones de negocio automáticamente.

## Diagnóstico mínimo

1. Confirmar `/health` del backend.
2. Confirmar que las variables estén presentes en el mismo entorno del deployment.
3. Confirmar la fila activa `confianza` en la base del backend.
4. Probar una activación con datos sintéticos de Confianza y un código vigente.
5. Revisar que un rechazo de Confianza se traduzca a `LINK_INVALID`, no a un error de
   configuración o de red.

`/health` por sí solo solo prueba que la función arranca; no prueba la integración.
