# PRD: Hito S2 - herramientas reales, reintentos y trazabilidad del agente

**Estado:** implementado en código; evidencia E2E pendiente de ejecutar con servicios configurados
**Fecha:** 2026-11-03
**Repositorio propietario:** `waylo.ai-backend`
**Entrega:** agente Waylo contra Grok/Reto con evidencia reproducible

## Problema y objetivo

El agente ya declara y ejecuta herramientas patient-scoped de ConfianzaIPS, pero el
hito S2 exige evidencia operativa adicional: al menos tres herramientas reales,
recuperación ante fallos del proveedor o de la IPS, y diez ejecuciones de extremo a
extremo registradas. El backend debe conservar una trazabilidad útil sin guardar
mensajes, documentos, tokens, claves ni datos clínicos crudos.

El objetivo es que una ejecución de chat tenga un identificador auditable, registre
su resultado y herramientas usadas, y pueda reintentarse de forma acotada cuando el
fallo sea transitorio. El registro debe servir para la demo y para investigar una
ejecución sin convertir el log en una copia de la conversación.

## Alcance

### Incluido

- Mantener las herramientas IPS existentes y demostrar tres herramientas de lectura
  con el adaptador Confianza real: `list_appointment_catalog`,
  `find_earliest_availability` y `list_my_appointments`.
- Reintentar con backoff acotado llamadas transitorias a Reto (red, 408, 425, 429 y
  5xx) sin reintentar errores 4xx permanentes.
- Reintentar fallos transitorios de red o respuestas 429/5xx en el cliente Confianza.
- Persistir un registro `AgentExecution` con id, estado, modelo, contador de
  herramientas, nombres de herramientas, reintentos, duración y código de error.
- Exponer una lectura interna limitada de los últimos registros para verificar la
  demo sin devolver secretos ni payloads.
- Añadir un script que ejecute diez solicitudes contra un backend configurado y
  escriba un JSONL de evidencia sanitizada.
- Añadir pruebas de reintento, registro y error controlado; actualizar README y
  documentación del hito.

### Fuera del alcance

- Fabricar ejecuciones exitosas mediante mocks para presentarlas como evidencia E2E.
- Persistir prompts, respuestas, argumentos de tools, tokens o claves.
- Cambiar el proveedor, el modelo de Grok/Reto o la UX principal del chat.
- Ejecutar automáticamente operaciones de escritura de citas sin la confirmación
  firmada existente.

## Actores y responsabilidades

| Actor | Responsabilidad |
|---|---|
| Paciente | Autoriza el vínculo IPS y confirma cualquier escritura de cita. |
| `waylo.ai` | Envía el contexto de sesión al relay privado y presenta el resultado. |
| `waylo.ai-backend` | Protege el relay, llama a Grok/Reto, ejecuta tools, reintenta fallos transitorios y registra la ejecución. |
| ConfianzaIPS | Fuente real de catálogo, disponibilidad, citas e identidad institucional. |
| Evaluador S2 | Revisa al menos tres tools reales, un error recuperado y diez registros verificables. |

## Contratos y flujo

1. `POST /internal/chat/completion` crea un `execution_id` y valida la clave
   interna.
2. El backend llama a Reto con `tools` solo cuando existe `external_subject`.
3. Una tool se valida con Zod y se ejecuta mediante `withActiveIpsClient`, que usa
   el token cifrado de la persona vinculada.
4. Un fallo transitorio se reintenta hasta el máximo configurado; un fallo
   permanente se devuelve al modelo como resultado controlado o como
   `LLM_UNAVAILABLE`, según la capa.
5. El backend responde con el texto y el `execution_id`; el registro persistente se
   completa de forma best-effort con estado, tools, reintentos, duración y error.
6. `GET /internal/chat/executions?limit=10` devuelve solo metadatos sanitizados y
   requiere la misma clave server-to-server.

## Datos y privacidad

`AgentExecution` no guarda el sujeto externo en claro. Guarda un HMAC con
`APP_SECRET`, el nombre del modelo/proveedor, nombres de tools, contadores,
duración, estado y código de error. Nunca guarda prompts, respuesta del modelo,
argumentos de tools, documentos, tokens ni claves. Si el registro falla, la respuesta
del paciente no se convierte en un error por problemas de observabilidad.

## Configuración

- `RETO_MAX_ATTEMPTS`: máximo de intentos por llamada a Reto (por defecto 3).
- `RETO_RETRY_DELAY_MS`: base del backoff en milisegundos (por defecto 250).
- `CONFIANZA_MAX_ATTEMPTS`: máximo de intentos para llamadas transitorias a
  Confianza (por defecto 3).
- `CONFIANZA_RETRY_DELAY_MS`: base del backoff de Confianza (por defecto 200).

Los valores nunca contienen secretos. Las claves existentes (`RETO_KEY`,
`WAYLO_INTERNAL_KEY`, `CONFIANZA_AGENT_KEY` e `IPS_TOKEN_KEY`) permanecen solo en
entornos server-side.

## Validaciones de aceptación

- Una ejecución con vínculo activo usa al menos tres endpoints reales de Confianza
  a través de tools, no respuestas simuladas.
- Un 503/429 o una caída de red transitoria provoca un reintento visible en el
  registro; un 401/403 no se reintenta indefinidamente.
- Cada solicitud devuelve un `execution_id` y deja un registro sanitizado aunque el
  proveedor falle.
- El comando de evidencia produce diez líneas con ids, estado, tools, reintentos y
  duración; se etiqueta claramente si una ejecución no alcanzó un proveedor real.
- Los tests cubren herramientas, error transitorio recuperado, error permanente y
  lectura interna protegida.

## Riesgos y preguntas abiertas

- La disponibilidad de las tools depende de que Grok emita `tool_calls`; el script
  y el video deben mostrar el recorrido decisión -> tool -> resultado.
- La base de datos de producción debe tener la migración aplicada antes de usar la
  lectura de ejecuciones.
- El costo exacto por tarea depende del consumo reportado por Reto; el JSONL no lo
  inventa y deja ese dato para la factura o dashboard del proveedor.
