# PRD: Backend adaptador de IPS para Waylo (MVP)

**Estado:** aprobado para implementación
**Fecha:** 2026-10-26
**Repositorio:** `waylo.ai-backend`

> **Alcance arquitectónico:** este PRD describe el MVP transitorio BFF +
> `external_subject`. La arquitectura objetivo fue redefinida por
> [`ADR-003`](./003-canonical-architecture-adr.md): el backend será la autoridad
> única y el BFF se conservará solo durante la migración.

## Problema y objetivo

El backend ya contiene un adaptador Confianza, pero el frontend ciudadano no usa sus
rutas de sesión ni puede llegar al adaptador de forma segura. Además, la URL configurada
puede duplicar `/api/v1`, Confianza está inactiva en el seed por defecto y la clave
servidor-a-servidor no está sincronizada.

Este MVP convierte el backend en una capa de integración server-to-server: recibe una
identidad externa de Waylo, activa el vínculo en la IPS, cifra el token devuelto y expone
lecturas normalizadas para el BFF de Next.js.

## Alcance

### Incluido

- Corrección del join de URLs del adaptador Confianza.
- Variable `WAYLO_INTERNAL_KEY` para proteger la API interna.
- Modelo persistente de vínculo por `external_subject`.
- Token IPS cifrado con AES-256-GCM.
- Endpoints internos de vínculo, estado, paciente y citas.
- Desvinculación local sin borrar datos en Confianza.
- Activación explícita de Confianza mediante configuración del seed.
- Pruebas del adaptador sin red y documentación del contrato.

### Fuera del alcance

- Autenticación del navegador.
- Chat, voz, LLM, RAG o calendario.
- Herramientas de citas del chat; se documentan en [`005-appointment-tools-prd.md`](./005-appointment-tools-prd.md).
- Sustituir todavía las rutas legacy `/ips/link` y `/me`.
- Guardar historia clínica o copiar datos de salud localmente.

## Arquitectura

```text
waylo.ai Route Handler
  -- X-Waylo-Internal-Key + external_subject -->
waylo.ai-backend /internal/ips/*
  -- X-Confianza-Agent-Key + Bearer token -->
Confianza IPS /api/v1/*
```

El navegador nunca conoce `WAYLO_INTERNAL_KEY`, `CONFIANZA_AGENT_KEY` ni el token IPS.

## Contrato interno

### Autenticación

Todas las rutas requieren el header:

```text
X-Waylo-Internal-Key: <secreto solo server-side>
```

El backend rechaza la solicitud si la clave no está configurada o no coincide.

### Endpoints

#### `POST /internal/ips/link`

Payload:

```json
{
  "external_subject": "id-de-persona-en-waylo",
  "ips_id": "confianza",
  "document_type": "CC",
  "document_number": "1032456789",
  "eps": "Confianza",
  "activation_code": "123456"
}
```

El backend llama a `POST /api/v1/integrations/agent/token`, valida la respuesta,
guarda el token cifrado y devuelve únicamente el estado del vínculo.

#### `GET /internal/ips/link?external_subject=...`

Devuelve `none`, `active`, `expired`, `unlinked` o `deactivated`, junto con el nombre
de la IPS y fechas de estado. Nunca devuelve el token.

#### `GET /internal/ips/patient?external_subject=...`

Descifra el token en memoria, llama a `GET /api/v1/patients/me` y devuelve el paciente
normalizado. No persiste la respuesta clínica.

#### `GET /internal/ips/appointments?external_subject=...`

Descifra el token en memoria, llama a `GET /api/v1/appointments` y devuelve citas
normalizadas. Las escrituras no se agregan a esta ruta: se ejecutan únicamente dentro
del ciclo de tools de `/internal/chat/completion`.

#### `DELETE /internal/ips/link?external_subject=...`

Borra el token cifrado y marca el vínculo como desvinculado dentro de Waylo. No modifica
la afiliación ni las citas de Confianza.

## Persistencia

Se crea `external_ips_links`, separada de las cuentas legacy del backend:

- `external_subject` único.
- `ips_id`.
- `patient_id` en la IPS.
- token IPS cifrado.
- expiración y estado.
- fechas de vínculo y cambio de estado.

El documento de identidad y el código de activación no se guardan en esta tabla.

## Configuración

- `CONFIANZA_BASE_URL`: origen de Confianza, por ejemplo `https://host`; el adaptador
  construye `/api/v1/...` sin duplicarlo.
- `CONFIANZA_AGENT_KEY`: mismo valor que `AGENT_API_KEY` en Confianza.
- `WAYLO_INTERNAL_KEY`: secreto compartido únicamente entre el BFF y este backend.
- `CONFIANZA_ENABLED=true`: activa la entrada Confianza en el seed de un entorno controlado.

Los valores reales se configuran en cada entorno y nunca se versionan.

## Reglas de error

- `401 UNAUTHORIZED`: clave interna inválida.
- `409 NO_ACTIVE_LINK`: no existe vínculo o el token expiró.
- `401 LINK_INVALID`: Confianza rechazó documento, EPS o código.
- `503 IPS_UNAVAILABLE`: error de red o respuesta 5xx de Confianza.
- `500 INTERNAL`: respuesta de Confianza incompatible con el contrato esperado.

## Validaciones de aceptación

- El adaptador nunca genera URLs con `/api/v1/api/v1`.
- El header de agente y el payload coinciden con `AgentTokenRequest` de Confianza.
- Un vínculo exitoso almacena un ciphertext que no contiene el token en claro.
- Las rutas internas no funcionan sin `X-Waylo-Internal-Key`.
- Las consultas usan exclusivamente el `patient_id` del token de agente.
- `GET /internal/ips/appointments` no aparece como ruta pública para el navegador.
- El seed no activa Confianza si el entorno no lo solicita explícitamente.

## Operación y despliegue

Antes de desplegar se deben configurar y verificar, sin imprimir valores:

1. `CONFIANZA_BASE_URL` sin `/api/v1` duplicado.
2. `CONFIANZA_AGENT_KEY` igual a `AGENT_API_KEY`.
3. `WAYLO_INTERNAL_KEY` igual al secreto server-side del frontend.
4. Confianza activa en el catálogo del backend.
5. Migración Prisma aplicada en una base aislada.

## Riesgos

- El backend y el frontend tienen bases independientes; `external_subject` es el puente
  explícito y no debe aceptarse desde el navegador sin la clave interna.
- La API de Confianza no ofrece todavía sexo, sede primaria, tipo de cita ni disponibilidad.
- La expiración del token requiere repetir activación; no se implementa refresh automático.
