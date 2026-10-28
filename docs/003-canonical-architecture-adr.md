# ADR-003: Arquitectura frontend-first de Waylo

**Estado:** aceptada y corregida
**Fecha:** 2026-10-27
**Alcance:** `waylo.ai`, `waylo.ai-backend` y su integración con ConfianzaIPS

## Decisión

`waylo.ai` sigue siendo el producto principal y conserva la prioridad arquitectónica.
Su frontend, experiencia de chat, autenticación actual, triage visible, límites de uso,
conversaciones locales y UX no se reemplazan ni se migran de forma implícita.

`waylo.ai-backend` funciona como una capa server-side de comunicación y herramientas:

- comunica el frontend con proveedores externos de IA;
- protege credenciales que no deben llegar al navegador;
- normaliza y transporta las consultas hacia las IPS;
- conserva los adaptadores y contratos técnicos de integración;
- ofrece endpoints internos protegidos para el frontend de Waylo.

El backend no se convierte en autoridad sustitutiva del frontend, no obliga a migrar
la autenticación existente y no reemplaza la base de datos actual de `waylo.ai` como
parte de esta decisión.

ConfianzaIPS permanece intacta como sistema externo de la IPS. Esta iniciativa no
modifica sus rutas, modelos, base de datos, frontend ni despliegue.

## Flujo objetivo inmediato

```text
Browser
  -> waylo.ai /api/triage
       - sesión, límites, red flags y UX actuales
       - contexto IPS mediante el cliente interno existente
  -> waylo.ai-backend /internal/chat/completion
       - valida la clave server-to-server
       - comunica con Reto usando una clave backend
  -> Reto
```

Para una pregunta sobre citas, el flujo adicional sigue siendo:

```text
waylo.ai /api/triage
  -> waylo.ai-backend /internal/ips/appointments
  -> adaptador Confianza existente
  -> ConfianzaIPS sin cambios
```

El navegador nunca recibe `WAYLO_INTERNAL_KEY`, `RETO_KEY`, `CONFIANZA_AGENT_KEY` ni
tokens de IPS.

## Límites de responsabilidad

| Área | Autoridad actual | Función del backend |
|---|---|---|
| UI, navegación y accesibilidad | `waylo.ai` | ninguna |
| Sesión y cuentas del producto | `waylo.ai` | no sustituirlas |
| Red flags y clasificación visible | `waylo.ai` | comunicación segura; validación futura |
| Conversaciones guardadas | `waylo.ai`/`localStorage` | no persistir historial automáticamente |
| Proveedor LLM | configuración server-side | relay seguro hacia Reto |
| Integración IPS | `waylo.ai-backend` | adaptadores y transporte |
| Pacientes y citas institucionales | ConfianzaIPS | fuente externa, sin cambios |

La conexión del chat no crea memoria clínica persistente. La conversación continúa
siendo estado de interfaz local; cualquier memoria paciente-scoped requiere una decisión
posterior, consentimiento explícito y un diseño clínico separado.

## Contratos

El contrato del primer incremento será un endpoint interno de comunicación para el chat.
No se expondrá directamente al navegador y requerirá `X-Waylo-Internal-Key`.

El backend debe validar tamaño, roles de mensaje, modelo permitido y configuración antes
de reenviar la solicitud. Los errores del proveedor se normalizan al contrato existente
de Waylo. El frontend conserva el formato `TriageResponse` que ya consume la UI.

## Consecuencias

### Beneficios

- se conserva el producto que ya funciona;
- la UI no cambia de forma innecesaria;
- el modelo deja de recibir llamadas directas desde la capa Next.js;
- las claves de IA quedan en una única capa server-side de comunicación;
- la integración IPS existente se reutiliza sin modificar ConfianzaIPS;
- se puede evolucionar después hacia streaming o WebSocket sin reescribir el chat.

### Costes y riesgos

- una llamada adicional entre `waylo.ai` y `waylo.ai-backend`;
- configuración coordinada de `WAYLO_BACKEND_URL`, `WAYLO_BACKEND_KEY` y la clave del proveedor;
- la disponibilidad del chat dependerá también del backend integrador;
- deben mantenerse pruebas de contrato en ambos repositorios.

## Fuera del alcance

- migrar cuentas, sesiones o la base Neon;
- mover toda la lógica de triage al backend;
- implementar WebSocket o streaming en esta primera conexión;
- modificar ConfianzaIPS;
- modificar contratos, rutas o esquemas de la IPS;
- introducir memoria clínica persistente.
