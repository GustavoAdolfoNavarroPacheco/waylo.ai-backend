# Reporte técnico S2: herramientas, reintentos y trazabilidad

- **Fecha de corte:** 2026-11-05
- **Repositorio:** `waylo.ai-backend`
- **Rama revisada:** `fix/s2-evidence-validation`
- **Commit de referencia:** `be9f959`
- **Evidencia adjunta:** [`evidence/s2-executions.jsonl`](./evidence/s2-executions.jsonl)

## Resumen ejecutivo

El backend implementa herramientas IPS conectadas mediante el adaptador de
ConfianzaIPS, reintentos acotados para fallos transitorios de Reto y Confianza,
y registros sanitizados de ejecución. La ruta del chat devuelve un identificador
de ejecución y persiste metadatos operativos cuando la base de datos y la
migración están disponibles.

El archivo JSONL revisado contiene diez respuestas HTTP 200 y diez
`execution_id`. Sin embargo, no contiene estado de agente, nombres de
herramientas, contador de reintentos ni duración de servidor. Por tanto, demuestra
diez respuestas del endpoint, pero no confirma que las diez ejecuciones hayan
quedado registradas ni que el modelo haya invocado las herramientas reales. La
recuperación de un error transitorio tampoco queda demostrada en este archivo.

## Alcance del backend

El flujo implementado en esta rama es:

```text
POST /internal/chat/completion
  -> Reto/Grok con definiciones de herramientas
  -> despacho validado de la herramienta IPS
  -> vínculo IPS activo y token institucional cifrado
  -> adaptador ConfianzaIPS
  -> resultado de herramienta al modelo
  -> respuesta y metadatos sanitizados de ejecución
```

El relay valida la clave server-to-server y solo habilita las herramientas IPS
cuando recibe `external_subject`. Cada operación se valida con Zod y se ejecuta
con el vínculo IPS activo del sujeto. La lógica está en
[`src/modules/chat/routes.ts`](../src/modules/chat/routes.ts),
[`src/modules/chat/appointment-tools.ts`](../src/modules/chat/appointment-tools.ts)
y [`src/modules/ips/confianza.ts`](../src/modules/ips/confianza.ts).

## Herramientas disponibles

El backend declara diez herramientas que consultan o modifican datos del paciente
en ConfianzaIPS cuando el entorno apunta a esa instancia real:

| Herramienta | Operación | Regla relevante |
|---|---|---|
| `get_patient_profile` | Consulta el perfil institucional propio. | Solo lectura. |
| `list_appointment_catalog` | Consulta servicios, médicos y sedes. | Los datos proceden del catálogo configurado. |
| `find_availability` | Consulta horarios por médico, servicio y fecha. | Requiere IDs y fecha válidos. |
| `find_earliest_availability` | Busca los primeros cupos de un servicio. | Compone consultas de médicos y disponibilidad diaria, con una búsqueda acotada. |
| `list_my_appointments` | Consulta las citas del paciente vinculado. | Solo lectura y ámbito del paciente. |
| `create_appointment` | Solicita una cita. | Exige confirmación explícita y firmada antes de escribir. |
| `cancel_appointment` | Cancela una cita propia. | Exige confirmación explícita y firmada antes de escribir. |
| `reschedule_appointment` | Reprograma una cita propia. | Exige confirmación explícita y firmada antes de escribir. |
| `get_clinical_history` | Consulta la historia clínica institucional propia. | Solo lectura; no produce diagnósticos. |
| `get_appointment_confirmation_document` | Solicita la constancia institucional de una cita. | Se ejecuta cuando el paciente la solicita. |

Las operaciones de escritura usan un token firmado de confirmación con vigencia
de cinco minutos. Una primera solicitud genera un resumen para que la persona
confirme; no modifica la cita en ese paso.

## Reintentos y manejo de errores

Reto y Confianza reintentan fallos de red y respuestas `408`, `425`, `429` y
`5xx`, con backoff exponencial acotado. Por defecto, ambos clientes permiten
tres intentos; la espera base es de 250 ms para Reto y 200 ms para Confianza.
Los errores permanentes de autorización no entran en ese conjunto de reintentos.
Los valores se configuran con `RETO_MAX_ATTEMPTS`, `RETO_RETRY_DELAY_MS`,
`CONFIANZA_MAX_ATTEMPTS` y `CONFIANZA_RETRY_DELAY_MS`.

El campo persistido `retry_count` se alimenta de los reintentos de Reto. El
cliente de Confianza sí reintenta internamente, pero esos intentos no se suman
actualmente a dicho contador. Esta limitación debe tenerse en cuenta al usar el
registro para atribuir la recuperación a una capa específica.

## Trazabilidad y privacidad

La tabla `agent_executions` guarda `execution_id`, hash HMAC del sujeto externo,
proveedor, modelo, estado, nombres y cantidad de herramientas, reintentos,
duración y código de error. El sujeto se seudonimiza con `APP_SECRET`. No se
persisten prompts, respuestas, argumentos de herramientas, tokens, claves ni
datos clínicos crudos. La lectura requiere la clave interna y usa
`GET /internal/chat/executions?limit=10`.

La implementación se encuentra en
[`src/modules/chat/execution-log.ts`](../src/modules/chat/execution-log.ts),
con esquema Prisma y migración en
[`prisma/schema.prisma`](../prisma/schema.prisma) y
[`prisma/migrations/20261103120000_agent_executions/migration.sql`](../prisma/migrations/20261103120000_agent_executions/migration.sql).

## Resultado de la evidencia disponible

El archivo [`s2-executions.jsonl`](./evidence/s2-executions.jsonl) contiene diez
solicitudes secuenciales: dos escenarios de perfil, tres de catálogo, tres de
primeros cupos y dos de citas. Los valores observados son:

| Indicador | Resultado |
|---|---:|
| Solicitudes HTTP | 10 |
| Respuestas HTTP 200 | 10 |
| `execution_id` presentes | 10 |
| `agent_status` presente | 0 |
| Filas con `tool_names` | 0 |
| Filas con `retry_count` | 0 |
| Duración cliente media | 4.57 s |
| Duración cliente mediana | 3.61 s |
| Rango de duración cliente | 1.80–10.95 s |
| Costo por solicitud | No disponible en el JSONL |

Las duraciones son medidas por el script alrededor de cada solicitud HTTP; no
son duraciones internas del servidor. En las diez filas, `agent_status`,
`tool_count`, `retry_count` y `server_duration_ms` son `null` o están vacíos; el
archivo tampoco incluye `audit_http_status`. El valor `error: null` no permite
concluir que no hubo reintentos, porque el contador no fue recuperado.

La versión actual del script valida que la auditoría y las tres herramientas
requeridas aparezcan en la evidencia, y termina con código distinto de cero si
faltan. Este JSONL no contiene los campos añadidos por esa validación; debe
tratarse como evidencia parcial de respuesta HTTP, no como prueba completa de
llamadas IPS o de ejecución persistida. El runner llama directamente al endpoint
interno del backend; la demostración del recorrido visible debe hacerse desde el
chat de Waylo.

## Estado frente al hito

| Criterio S2 | Estado de implementación | Evidencia incluida |
|---|---|---|
| Tres herramientas reales | Las herramientas y el adaptador están implementados. | El JSONL no registra nombres de herramientas; su uso real queda sin verificar. |
| Errores y reintentos | Hay reintentos acotados en Reto y Confianza. | El JSONL no registra `retry_count` ni un error recuperado. |
| Diez ejecuciones registradas | El endpoint crea IDs y existe almacenamiento de auditoría. | Hay diez IDs HTTP 200, pero no se recuperaron los metadatos de auditoría. |
| Costo por tarea | No forma parte del registro interno. | Consultar la facturación o el panel de uso del proveedor. |
| Video de dos minutos | No se incluye en este reporte. | Adjuntar por separado en la entrega del hito. |

## Reproducción y próximos pasos

Para obtener evidencia completa, inicia el backend con la migración aplicada,
una base accesible, credenciales server-side configuradas, un vínculo IPS activo
y `CONFIANZA_BASE_URL` apuntando a ConfianzaIPS real. Ejecuta desde la raíz del
checkout del backend:

```bash
set -a
. ./.env
set +a

S2_INTERNAL_KEY="$WAYLO_INTERNAL_KEY" \
S2_EXTERNAL_SUBJECT="ID_DE_LA_SESION_WAYLO_VINCULADA" \
npm run s2:evidence
```

El sujeto debe corresponder a la sesión Waylo vinculada, no al documento del
paciente. Antes de usar el JSONL como evidencia, comprueba diez registros
auditados, `agent_status: "succeeded"`, y presencia de
`list_appointment_catalog`, `find_earliest_availability` y
`list_my_appointments`. Para mostrar recuperación, registra una falla transitoria
real y un reintento exitoso; el script no inyecta fallos. Consulta el costo por
tarea en la fuente de facturación del proveedor y anótalo aparte.

La creación de este reporte no ejecutó llamadas externas ni pruebas automatizadas.

## Anexo A: contenido del JSONL incluido

El siguiente bloque reproduce sin cambios el archivo
[`evidence/s2-executions.jsonl`](./evidence/s2-executions.jsonl):

```jsonl
{"run":1,"scenario":"profile-1","execution_id":"bd7876cb-4409-47d4-add6-8d153cdedfde","http_status":200,"ok":true,"duration_ms":6802,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":2,"scenario":"catalog-1","execution_id":"525483ca-2060-4e3c-8649-6924316a89b1","http_status":200,"ok":true,"duration_ms":5156,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":3,"scenario":"earliest-1","execution_id":"543b5c04-2e41-4188-a911-729905e5f460","http_status":200,"ok":true,"duration_ms":3837,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":4,"scenario":"appointments-1","execution_id":"52f652e8-640e-446d-8bca-c5b5e9a61477","http_status":200,"ok":true,"duration_ms":3350,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":5,"scenario":"profile-2","execution_id":"99829fdf-bcba-47ec-99de-0be065bdadfa","http_status":200,"ok":true,"duration_ms":3391,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":6,"scenario":"catalog-2","execution_id":"03f62f06-7281-45b6-8cc0-fa793197933b","http_status":200,"ok":true,"duration_ms":10954,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":7,"scenario":"earliest-2","execution_id":"e2f75eb2-f2fb-433a-b626-a62efe13e453","http_status":200,"ok":true,"duration_ms":1803,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":8,"scenario":"appointments-2","execution_id":"71e5180b-5f47-4cda-99ad-db5e859accdc","http_status":200,"ok":true,"duration_ms":3101,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":9,"scenario":"earliest-3","execution_id":"53edfe7f-09f5-4af9-87bd-e1367d679756","http_status":200,"ok":true,"duration_ms":4071,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
{"run":10,"scenario":"catalog-3","execution_id":"2cb202f8-fa7b-48e7-a9e1-36fa94f029a5","http_status":200,"ok":true,"duration_ms":3233,"error":null,"agent_status":null,"tool_names":[],"tool_count":null,"retry_count":null,"server_duration_ms":null}
```
