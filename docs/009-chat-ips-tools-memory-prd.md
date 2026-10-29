# PRD: relay conversacional, tools IPS y contexto paciente-scoped

**Estado:** aprobado para implementación
**Fecha:** 2026-10-29
**Repositorio propietario:** `waylo.ai-backend`
**Consumidor:** `waylo.ai`
**Fuente institucional:** `ConfianzaIPS`

## Problema y objetivo

El backend ya registra `POST /internal/chat/completion` y contiene tools de citas,
pero el frontend actual no envía el sujeto de sesión ni llama a este endpoint. El
relay debe convertirse en la única puerta server-to-server para el chat con tools,
manteniendo la separación entre Waylo, la IPS y el navegador.

El objetivo es habilitar todas las operaciones patient-scoped que el adaptador
canónico ya soporta, sin exponer capacidades administrativas ni tokens IPS.

## Alcance

### Tools patient-scoped

- `get_patient_profile`
- `list_appointment_catalog`
- `find_availability`
- `find_earliest_availability`
- `list_my_appointments`
- `create_appointment`
- `cancel_appointment`
- `reschedule_appointment`
- `get_clinical_history` como lectura explícita y controlada
- `get_appointment_confirmation_document` para una cita propia

La activación y desvinculación de IPS permanecen en las rutas BFF de configuración;
no son tools conversacionales. Las rutas administrativas, de personal, creación de
catálogos, pacientes ajenos y escritura clínica quedan fuera del alcance.

## Flujo

```text
waylo.ai /api/triage
  -> X-Waylo-Internal-Key
  -> /internal/chat/completion
       external_subject
       messages
       pending_appointment_token opcional
  -> proveedor Reto con tools
  -> tool validada por Zod
  -> vínculo externo activo
  -> token IPS descifrado solo en backend
  -> adaptador canónico
  -> ConfianzaIPS
```

## Contrato interno

El endpoint conserva el payload actual y acepta:

- `external_subject`: obligatorio cuando el modelo pueda ejecutar tools.
- `pending_appointment_token`: opcional, temporal y asociado al sujeto.
- mensajes con roles `user` y `assistant`.

La respuesta conserva `text` y puede incluir `pending_appointment` con acción,
resumen y token HMAC de cinco minutos. El token se invalida si cambia el sujeto,
la acción o cualquier argumento, o si expira.

## Reglas de ejecución

- Sin vínculo activo, ninguna tool IPS se ejecuta.
- `401` o `403` de la IPS desactivan el vínculo local y limpian la caché asociada.
- Las operaciones de escritura requieren primera propuesta y confirmación explícita.
- La confirmación solo permite ejecutar exactamente los argumentos propuestos.
- Las escrituras nunca usan caché.
- Las lecturas pueden usar la política de caché existente cuando corresponda.
- El backend nunca persiste mensajes, respuestas completas, llamadas de tools ni
  tokens de confirmación.
- Los errores de proveedor o IPS se normalizan sin inventar disponibilidad ni citas.

## Compatibilidad con Confianza

El adaptador continúa normalizando el contrato institucional actual. No se agrega
`type` al payload de Confianza porque su API v0.1 no lo define. La búsqueda de
primeros cupos continúa componiéndose con disponibilidad por médico y día dentro
de los límites establecidos.

Los nombres de médico, sede, tipo de cita o sede primaria solo se muestran cuando
la IPS o un catálogo autorizado los entrega.

## Seguridad

- `WAYLO_INTERNAL_KEY` se valida con comparación segura.
- `CONFIANZA_AGENT_KEY` solo se usa en el adaptador server-side.
- `IPS_TOKEN_KEY` descifra tokens únicamente dentro del backend.
- `external_subject` no se acepta como identidad institucional ni como `patient_id`.
- Toda resolución de vínculo se realiza por el sujeto externo y el registro local.

## Validaciones de aceptación

- El relay recibe y reenvía el sujeto externo sin exponerlo como identidad clínica.
- Las diez tools patient-scoped pasan validación de esquema y contrato.
- Los tests cubren catálogo, disponibilidad, citas, historia, documento y errores.
- Los tests cubren propuesta, confirmación, rechazo y expiración de escrituras.
- Un vínculo inexistente genera `NO_ACTIVE_LINK` controlado.
- Un proveedor sin function calling degrada a error normalizado.
- `npm run typecheck`, `npm run build` y la suite backend pasan.
- Una prueba E2E conectada con Confianza se reporta separadamente de los mocks.

## Variables requeridas

En el backend deben existir, según el entorno:

- `WAYLO_INTERNAL_KEY`
- `RETO_KEY`
- `RETO_BASE_URL` y `RETO_MODEL` cuando no se usen sus valores por defecto
- `CONFIANZA_BASE_URL`
- `CONFIANZA_AGENT_KEY`
- `IPS_TOKEN_KEY`
- `CONFIANZA_ENABLED=true` al ejecutar el seed que activa Confianza

Los valores nunca se guardan en Git, documentación, tests reales ni logs.
