# PRD: Conexión del chat principal con `waylo.ai-backend`

**Estado:** plan de implementación
**Fecha:** 2026-10-27
**Repositorios:** `waylo.ai` y `waylo.ai-backend`

## Problema y objetivo

El chat ciudadano funciona en `waylo.ai`, pero su Route Handler llama directamente al
gateway Reto. `waylo.ai-backend` ya existe como capa segura de comunicación y también
gestiona el acceso server-to-server a la IPS.

El objetivo es conectar el chat principal al backend sin alterar la experiencia actual,
sin migrar la arquitectura del frontend y sin tocar ConfianzaIPS.

## Alcance

Incluido:

- nuevo endpoint interno de chat en `waylo.ai-backend`;
- autenticación mediante `X-Waylo-Internal-Key`;
- reenvío server-side al endpoint compatible con OpenAI de Reto;
- validación de payload, tamaño, roles y configuración;
- cambio de `waylo.ai` para usar el backend como transporte LLM;
- conservación del formato actual de `TriageResponse`;
- pruebas unitarias de éxito, credencial inválida, proveedor no disponible y payload inválido;
- documentación de variables y flujo.

Fuera del alcance:

- cambios en ConfianzaIPS;
- cambios en las rutas de la IPS;
- migración de usuarios, sesiones, Neon o conversaciones;
- mover red flags, límites o la tarjeta de orientación al backend;
- voz, adjuntos y títulos; se mantienen en el flujo actual hasta una fase posterior;
- WebSocket o streaming.

## Flujo técnico

1. `ChatApp` sigue enviando `POST /api/triage`.
2. Next.js mantiene la sesión, límite de uso, red flags, sanitización y contexto IPS.
3. `runTriage` construye el mismo prompt y los mismos mensajes que utiliza hoy.
4. En lugar de llamar a Reto directamente, realiza una petición server-side a
   `POST /internal/chat/completion`.
5. `waylo.ai-backend` valida `X-Waylo-Internal-Key` y el payload.
6. El backend llama a Reto con la clave configurada en su entorno.
7. El backend devuelve el texto del modelo y Next.js mantiene el parseo JSON,
   clasificación y presentación actuales.

## Contrato interno propuesto

`POST /internal/chat/completion`

Headers:

- `X-Waylo-Internal-Key` obligatorio;
- `Content-Type: application/json`.

Body:

```json
{
  "model": "grok-4.20-0309-non-reasoning",
  "temperature": 0.4,
  "system": "...",
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

Respuesta exitosa:

```json
{ "text": "{...respuesta estructurada del modelo...}" }
```

El endpoint no persiste mensajes ni respuestas.

## Seguridad

- El navegador no conoce el endpoint interno ni la clave interna.
- `X-Waylo-Internal-Key` solo existe en el entorno server-side de Next.js.
- La clave de Reto del chat solo existe en `waylo.ai-backend`; voz y títulos conservan temporalmente su flujo actual.
- ConfianzaIPS no recibe cambios.
- El backend limita el tamaño de `system`, mensajes y contenido total.
- Los mensajes se aceptan únicamente con roles `system`, `user` y `assistant`.

## Validación

- pruebas existentes de `waylo.ai` deben conservarse;
- nuevas pruebas del backend cubren autenticación y proxy del proveedor;
- nuevas pruebas del frontend verifican que no se llame directamente al gateway;
- `npm run typecheck`, `npm run build` y las suites disponibles deben ejecutarse en
  ambos repositorios;
- la comprobación IPS se limita a los adaptadores existentes, sin modificar ni seedear
  ConfianzaIPS.
