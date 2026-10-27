# Waylo–Confianza IPS: registro completo de trabajo

**Fecha de esta documentación:** 2026-10-26
**Estado:** MVP de integración implementado y probado parcialmente de forma local
**Alcance:** `waylo.ai`, `waylo.ai-backend`, `ConfianzaIPS/confianza-ips-backend` y `ConfianzaIPS/confianza-ips-frontend`

Este documento reúne la trazabilidad completa del trabajo realizado durante este chat:
la situación inicial, las decisiones de arquitectura, los archivos creados y modificados,
los comportamientos agregados o cambiados, las pruebas, los commits, la configuración y
los límites de validación que permanecen.

## 1. Situación inicial y problema detectado

El workspace no era un solo proyecto. Contenía cuatro repositorios independientes:

```text
/home/alexi-dg/Desktop/Waylo/
├── waylo.ai/                              # Frontend ciudadano Next.js
├── waylo.ai-backend/                      # Backend/adaptador Fastify + Prisma
└── ConfianzaIPS/
    ├── confianza-ips-backend/             # API institucional FastAPI
    └── confianza-ips-frontend/            # Frontend institucional React/Vite
```

La auditoría inicial encontró estas brechas:

1. `waylo.ai` tenía una experiencia ciudadana funcional, pero no consumía
   `waylo.ai-backend`.
2. `waylo.ai-backend` tenía un adaptador de Confianza, pero el flujo ciudadano no tenía
   una conexión server-side con él.
3. El backend tenía rutas legacy basadas en su propia autenticación, distinta de la
   sesión del frontend ciudadano.
4. El adaptador podía construir URLs duplicadas como:

   ```text
   /api/v1/api/v1/integrations/agent/token
   ```

5. No existía una tabla para vincular una sesión externa de Waylo con un paciente de la
   IPS.
6. El backend y Confianza tenían claves de agente diferentes en los entornos revisados.
7. El frontend no podía usar de forma segura secretos, tokens ni credenciales de la IPS.

La decisión central fue conservar el frontend existente y convertir el backend en un
adaptador server-to-server. El navegador no habla directamente ni con Confianza ni con
`waylo.ai-backend`.

## 2. Arquitectura final del MVP

```text
Paciente
  │
  ▼
waylo.ai / EpsPanel
  │  sesión Waylo
  ▼
Next.js BFF: /api/ips/*
  │  X-Waylo-Internal-Key + external_subject
  ▼
waylo.ai-backend: /internal/ips/*
  │  X-Confianza-Agent-Key + Bearer token IPS
  ▼
Confianza IPS: /api/v1/*
```

### Identidad del vínculo

El backend usa el `session.id` de Waylo como `external_subject`. Esto permite conectar
la sesión del ciudadano con el paciente institucional sin compartir cookies ni migrar la
autenticación existente.

### Flujo de activación

1. El paciente inicia sesión en Waylo.
2. Selecciona Confianza en Configuración → EPS.
3. Activa la autorización existente de Waylo.
4. Escribe nuevamente su cédula y el código temporal emitido por Confianza.
5. Waylo valida el payload en el Route Handler.
6. `waylo.ai` llama a `POST /internal/ips/link`.
7. `waylo.ai-backend` llama a `POST /api/v1/integrations/agent/token` de Confianza.
8. Confianza devuelve un token limitado al paciente.
9. El backend cifra el token y lo guarda en `external_ips_links`.
10. El frontend recibe únicamente el estado del vínculo, nunca el token.

### Flujo de consulta de citas

1. El paciente pregunta por una cita, turno o agenda en el chat.
2. El Route Handler de triage detecta la intención en el último mensaje.
3. Si hay sesión Waylo, consulta `/api/ips/appointments`.
4. El BFF llama a `/internal/ips/appointments`.
5. El backend descifra el token en memoria y consulta `/api/v1/appointments`.
6. Las citas normalizadas se agregan al contexto del agente.
7. El agente responde con los datos recibidos, sin inventar citas.

Si la IPS no responde o no hay vínculo, el triage continúa sin romperse y recibe un
contexto controlado que le impide inventar información.

## 3. Cambios en `waylo.ai`

Repositorio: `/home/alexi-dg/Desktop/Waylo/waylo.ai`

### Archivos creados

- `docs/001-ips-integration-mvp-prd.md`
  - PRD propio del frontend ciudadano.
  - Define objetivo, alcance, actores, contratos, reglas de seguridad, estados y
    aceptación.
- `src/lib/ips.ts`
  - Tipos de vínculo, paciente y cita normalizados en el frontend.
- `src/lib/ips-backend.ts`
  - Cliente server-side hacia `waylo.ai-backend`.
  - Lee `WAYLO_BACKEND_URL` y `WAYLO_BACKEND_KEY` únicamente desde el entorno servidor.
  - Envía `X-Waylo-Internal-Key`.
  - Convierte errores del backend en `IpsBackendError`.
- `src/app/api/ips/link/route.ts`
  - `GET`: estado del vínculo.
  - `POST`: validación y activación.
  - `DELETE`: desvinculación.
- `src/app/api/ips/patient/route.ts`
  - Consulta server-side del paciente normalizado.
- `src/app/api/ips/appointments/route.ts`
  - Consulta server-side de citas normalizadas.
- `src/app/api/ips/link/route.test.ts`
  - Pruebas de sesión, validación, mapeo y desvinculación.
- `src/lib/ips-backend.test.ts`
  - Pruebas de headers, payload, URL y propagación tipada de errores.

### Archivos modificados

- `src/app/api/configuracion/route.ts`
  - Incluye `ips` en la respuesta de configuración.
  - Para usuarios no autenticados devuelve estado `none`.
  - Si el backend adaptador no responde, devuelve estado `unavailable` sin bloquear el
    resto de la configuración.
- `src/app/api/configuracion.test.ts`
  - Se actualizó para cubrir el nuevo campo `ips`.
- `src/app/api/triage/route.ts`
  - Detecta preguntas sobre citas, turnos, agenda, appointments y consultas.
  - Consulta la IPS solo para usuarios autenticados y cuando corresponde.
  - Maneja vínculo inexistente y backend/IPS no disponible.
- `src/app/api/triage/route.test.ts`
  - Se agregaron pruebas de carga de contexto de citas y degradación controlada cuando
    la IPS está caída.
- `src/lib/triage.ts`
  - Añade `ipsContext` al input del agente.
  - Incluye los datos de Confianza en las instrucciones del modelo solo para preguntas
    sobre citas.
- `src/components/settings/EpsPanel.tsx`
  - Mantiene la configuración EPS local existente.
  - Añade estado visual de conexión con Confianza.
  - Añade conexión, desconexión, estados de expiración y errores localizados.
  - Envía `document_type`, cédula, EPS y código temporal a `/api/ips/link`.
  - La cédula guardada sigue llegando enmascarada; por eso se exige escribirla otra vez
    para el intercambio de activación.
- `src/components/settings/SettingsDialog.tsx`
  - Pasa el estado `ips` al panel EPS.
- `src/i18n/messages/es.ts`
- `src/i18n/messages/en.ts`
- `src/i18n/messages/pt.ts`
  - Añaden traducciones para conexión, desconexión, expiración, disponibilidad, errores
    y contexto de citas.
- `.env.example`
  - Añade `WAYLO_BACKEND_URL` y `WAYLO_BACKEND_KEY`.
- `README.md`
  - Documenta el BFF y la regla de no exponer secretos al navegador.

### Cambio de comportamiento importante en el panel EPS

La funcionalidad EPS local no fue eliminada: la ruta `/api/eps`, su persistencia cifrada,
la autorización y el estado local siguen existiendo.

El ingreso de un código nuevo cambió de comportamiento para el flujo de Confianza:

- Antes, al completar el código, el panel lo enviaba automáticamente a `/api/eps` para
  guardarlo localmente.
- Ahora, el código se conserva temporalmente en memoria y se envía explícitamente al
  pulsar “Conectar con Confianza”.
- Después de una activación exitosa se limpia del estado del componente.
- El backend no recibe ni guarda la cédula o el código como persistencia propia.

Esto evita confundir un dato local de EPS con un vínculo institucional real.

## 4. Cambios en `waylo.ai-backend`

Repositorio: `/home/alexi-dg/Desktop/Waylo/waylo.ai-backend`

### Archivos creados

- `docs/001-ips-integration-mvp-prd.md`
  - PRD del adaptador backend.
- `src/modules/ips/external.ts`
  - Registra las rutas privadas `/internal/ips/*`.
  - Exige `X-Waylo-Internal-Key` mediante comparación segura.
  - Usa `external_subject` como identidad externa.
  - Resuelve la IPS activa y crea el cliente Confianza.
  - Cifra el token con AES-256-GCM antes de persistirlo.
  - Nunca devuelve el token.
  - Marca el vínculo como desactivado cuando Confianza rechaza el token.
- `prisma/migrations/20261026210000_external_ips_links/migration.sql`
  - Crea la tabla nueva de vínculos externos.
- `test/confianza.test.ts`
  - Prueba la resolución correcta de URL y el contrato de activación.
  - Prueba el mapeo de paciente y citas.
- `test/external-ips-auth.test.ts`
  - Prueba que las rutas internas rechazan solicitudes sin clave.
- `test/external-ips-link.test.ts`
  - Prueba el intercambio de código, el cifrado del token y que la respuesta no lo
    expone.

### Archivos modificados

- `src/config.ts`
  - Añade `WAYLO_INTERNAL_KEY` opcional con mínimo de 32 caracteres.
  - Añade `CONFIANZA_ENABLED`.
  - Corrige el parseo booleano para que el texto `"false"` no se interprete como `true`.
- `src/errors.ts`
  - Añade `INTEGRATION_UNAVAILABLE` y el error correspondiente de estado 503.
- `src/app.ts`
  - Registra las rutas privadas del adaptador.
- `src/modules/ips/confianza.ts`
  - Cambia la composición de URLs a `new URL(...)`.
  - Evita duplicar `/api/v1` cuando `CONFIANZA_BASE_URL` ya contiene ese prefijo.
- `src/modules/ips/types.ts`
  - Añade estados externos `none`, `active`, `expired`, `unlinked` y `deactivated`.
- `prisma/schema.prisma`
  - Añade la relación `externalLinks` a `Ips`.
  - Añade el modelo `ExternalIpsLink`.
- `src/seed/ips.ts`
  - Permite activar Confianza solo cuando `CONFIANZA_ENABLED=true`.
  - Sin esa variable, el catálogo de Confianza permanece inactivo.
- `test/helpers.ts`
  - Añade la configuración de prueba para `CONFIANZA_ENABLED`.
- `.env.example`
  - Documenta `CONFIANZA_ENABLED` y `WAYLO_INTERNAL_KEY`.
- `README.md`
  - Documenta el adaptador ciudadano, sus rutas internas y sus variables.

### Modelo persistente nuevo

Tabla: `external_ips_links`

Campos principales:

- `external_subject`: identificador único de la sesión Waylo.
- `ips_id`: IPS institucional utilizada.
- `patient_id`: paciente dueño del token en Confianza.
- `access_token_encrypted`: token cifrado.
- `token_expires_at`: expiración del token.
- `status`: estado persistente del vínculo.
- `linked_at` y `status_changed_at`: trazabilidad temporal.

No se guardan en esta tabla:

- Documento de identidad.
- Código de activación.
- Token IPS en texto plano.
- Historia clínica o copia local de citas.

### Rutas internas creadas

#### `POST /internal/ips/link`

Recibe `external_subject`, `ips_id`, `document_type`, `document_number`, `eps` y
`activation_code`. Intercambia el código contra Confianza y devuelve solo el estado.

#### `GET /internal/ips/link?external_subject=...`

Devuelve el estado del vínculo sin revelar secretos.

#### `GET /internal/ips/patient?external_subject=...`

Consulta `GET /api/v1/patients/me` usando el token cifrado.

#### `GET /internal/ips/appointments?external_subject=...`

Consulta `GET /api/v1/appointments` usando el token cifrado.

#### `DELETE /internal/ips/link?external_subject=...`

Elimina el token cifrado localmente y marca el vínculo como `UNLINKED`. No elimina la
afiliación ni las citas en Confianza.

## 5. Cambios en `confianza-ips-backend`

Repositorio: `/home/alexi-dg/Desktop/Waylo/ConfianzaIPS/confianza-ips-backend`

No se modificó código de producción en este repositorio durante este trabajo.

Se creó:

- `docs/006-waylo-agent-integration-mvp.md`
  - Documenta el contrato que Waylo consume.
  - Explica la emisión de códigos temporales.
  - Documenta activación, perfil y consulta de citas.
  - Reafirma que `AGENT_API_KEY`, `AGENT_ACTIVATION_SECRET` y `AGENT_JWT_SECRET` no
    llegan al navegador.
  - Define las brechas futuras: disponibilidad, creación, cancelación, reprogramación,
    historia clínica y documentos.

El frontend institucional ya tenía el flujo de emisión del código; por eso no fue
duplicado ni reemplazado.

## 6. Cambios en `confianza-ips-frontend`

Repositorio: `/home/alexi-dg/Desktop/Waylo/ConfianzaIPS/confianza-ips-frontend`

No se modificó código de producción en este repositorio durante este trabajo.

Se creó:

- `docs/006-waylo-agent-integration-mvp.md`
  - Documenta el papel del frontend institucional.
  - Mantiene login, dashboard y tarjeta de activación.
  - Explica que el paciente copia el código temporal hacia Waylo.
  - Prohíbe enviar el código directamente desde el navegador a Waylo.
  - Confirma que el frontend institucional no conoce las API keys del agente.

## 7. Lo que no se eliminó

No se eliminaron archivos funcionales, tablas existentes, endpoints públicos ni datos de
usuarios.

En particular, no se eliminó:

- El triage existente.
- Las señales de alarma.
- La voz.
- Los adjuntos.
- El perfil y preferencias.
- La autenticación de Waylo.
- La persistencia local de EPS.
- Las rutas legacy del backend.
- El flujo de activación existente de Confianza.
- La interfaz institucional.

La modificación inicial de la migración Prisma existente fue descartada antes del
commit. La tabla externa quedó correctamente en una migración nueva para no alterar
retroactivamente una migración que pudiera estar aplicada en producción.

Tampoco se dejó un cambio incidental en `package-lock.json`: la instalación de
dependencias produjo diferencias temporales, pero el lockfile quedó restaurado y fuera
de los commits.

## 8. Pruebas ejecutadas

### `waylo.ai`

```text
npm test
28 archivos de prueba
392 pruebas exitosas

npx tsc --noEmit
exitoso

npm run lint
exitoso
```

También se ejecutó una suite enfocada de la integración:

```text
4 archivos
34 pruebas exitosas
```

Incluye rutas IPS, cliente server-side, configuración y triage.

### `waylo.ai-backend`

```text
npm run typecheck
exitoso

npm run build
exitoso

npx prisma validate
exitoso

Suite enfocada:
5 archivos
13 pruebas exitosas
```

### `confianza-ips-frontend`

```text
pnpm test
16 archivos de prueba
36 pruebas exitosas
```

### `confianza-ips-backend`

No se modificó código Python. La ejecución de pruebas no pudo completarse porque:

- `uv` intentó resolver `uv-build` desde PyPI.
- La red/DNS de la sandbox no permitió descargarlo.
- El `.venv` local tenía un intérprete apuntando a otra ruta de checkout.

## 9. Problemas de entorno identificados y corregidos

### Variables inválidas del backend

El `.env` local del backend contenía valores acompañados de comentarios inline, por lo
que `loadEnvFile` los interpretaba como parte del secreto. Esto produjo:

- `APP_SECRET` menor de 32 caracteres efectivos.
- `IPS_TOKEN_KEY` distinto de 64 caracteres hexadecimales.

Se generaron valores locales nuevos válidos para ambos campos. No se imprimieron ni se
versionaron.

### Variables todavía necesarias para E2E real

Para conectar los servicios fuera de pruebas unitarias todavía deben alinearse:

```text
waylo.ai/.env
  WAYLO_BACKEND_URL
  WAYLO_BACKEND_KEY

waylo.ai-backend/.env
  WAYLO_INTERNAL_KEY
  CONFIANZA_BASE_URL
  CONFIANZA_AGENT_KEY
  CONFIANZA_ENABLED=true

confianza-ips-backend/.env
  AGENT_API_KEY
  AGENT_ACTIVATION_SECRET
  AGENT_JWT_SECRET
```

`WAYLO_BACKEND_KEY` y `WAYLO_INTERNAL_KEY` deben ser el mismo secreto. `CONFIANZA_AGENT_KEY`
debe coincidir con `AGENT_API_KEY` de Confianza.

### Bloqueos de la sandbox

- Next.js/Turbopack intentó crear un proceso que debía abrir un puerto y recibió
  `Operation not permitted`.
- El backend validó la configuración, pero la sandbox bloqueó `listen` sobre
  `0.0.0.0:3001` con `EPERM`.
- El warning de Console Ninja sobre funcionalidades PRO no afecta la aplicación.
- El warning de Next.js sobre múltiples lockfiles no fue la causa del fallo de
  configuración.

## 10. Commits realizados

No se hizo push. Los commits fueron atómicos y quedaron en sus repositorios respectivos.

### `waylo.ai`

```text
45eb83d docs: :memo: document Waylo IPS integration MVP
9407d0c feat: :sparkles: connect Waylo to Confianza IPS
2b0e9d3 test: :white_check_mark: cover Waylo IPS integration
```

### `waylo.ai-backend`

```text
b8003aa docs: :memo: document adapter IPS integration MVP
a486505 feat: :sparkles: expose secure IPS adapter routes
7196896 test: :white_check_mark: cover secure IPS adapter
```

### `confianza-ips-backend`

```text
ab69f1a docs: :memo: document Waylo agent integration
```

### `confianza-ips-frontend`

```text
8e21260 docs: :memo: document Waylo activation flow
```

Los cuatro repositorios quedaron limpios y adelantados respecto a sus ramas remotas.

## 11. PRD y documentación por repositorio

- [PRD de `waylo.ai`](waylo.ai/docs/001-ips-integration-mvp-prd.md)
- [PRD de `waylo.ai-backend`](waylo.ai-backend/docs/001-ips-integration-mvp-prd.md)
- [PRD de `confianza-ips-backend`](ConfianzaIPS/confianza-ips-backend/docs/006-waylo-agent-integration-mvp.md)
- [PRD de `confianza-ips-frontend`](ConfianzaIPS/confianza-ips-frontend/docs/006-waylo-agent-integration-mvp.md)

## 12. Estado final

La brecha de arquitectura quedó cerrada a nivel de código y contratos:

- El frontend puede iniciar el vínculo con Confianza mediante el backend.
- El backend puede adaptar el contrato de Confianza.
- El token se almacena de forma cifrada.
- El agente puede consultar citas reales cuando existe un vínculo activo.
- Las funcionalidades locales existentes siguen siendo responsabilidad del frontend.
- Las pruebas unitarias y de integración enfocadas pasan.

El siguiente paso operativo es configurar los secretos compartidos y ejecutar una
validación real con los cuatro procesos conectados, una cuenta de paciente de prueba y
una base aislada. Ese paso no se realizó automáticamente porque requiere credenciales,
servicios levantados y validación externa de Confianza.
