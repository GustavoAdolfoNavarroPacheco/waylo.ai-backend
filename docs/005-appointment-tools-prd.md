# PRD: herramientas de citas en el chat

**Estado:** implementado en Waylo; pendiente de validación conectada contra una IPS real
**Propietario:** `waylo.ai-backend` (relay, seguridad y adaptador) + `waylo.ai` (chat y UX)
**Fecha:** 2026-10-27

## Problema y objetivo

El chat ya podía leer citas, pero no podía consultar disponibilidad ni solicitar,
cancelar o reprogramar una cita. El objetivo es que el modelo use function calling
para pedir datos reales a Waylo y que Waylo ejecute las operaciones autorizadas en la
IPS, sin que el modelo vea tokens ni que el navegador llame a la IPS.

## Alcance

Tools disponibles para una sesión Waylo vinculada:

- `list_appointment_catalog`: servicios, médicos y sedes activas.
- `find_availability`: cupos de un médico, servicio y fecha.
- `find_earliest_availability`: primeros cupos de un servicio y tipo de cita.
- `list_my_appointments`: citas del paciente autenticado.
- `create_appointment`: solicita una cita con tipo `general` o `priority`.
- `cancel_appointment`: cancela una cita propia.
- `reschedule_appointment`: cambia la fecha de una cita propia.

No se agregan rutas públicas de escritura. Las escrituras solo ocurren dentro del
ciclo de tools del endpoint privado `/internal/chat/completion`.

## Flujo y actores

1. `waylo.ai` envía el historial, la sesión opaca y, si aplica, un token de confirmación.
2. El backend reenvía el chat a Reto con las definiciones de tools.
3. Reto solicita una tool; el backend valida nombre y argumentos con Zod.
4. El backend recupera el vínculo y token IPS del paciente, llama al adaptador y devuelve
   el resultado a Reto.
5. Para crear, cancelar o reprogramar, la primera llamada nunca escribe: devuelve un
   resumen y un token HMAC de cinco minutos.
6. Solo una respuesta explícita del paciente (`sí`, `confirmo`, `adelante`, etc.) y el
   token firmado permiten ejecutar exactamente la misma acción y argumentos.
7. El frontend muestra la respuesta final y mantiene el token únicamente en memoria.

## Contrato y datos

- El sujeto de la operación es `external_subject`, normalmente el id de sesión de
  Waylo; nunca es un `patient_id` enviado por el modelo.
- Los tokens de IPS permanecen cifrados en el backend.
- Los resultados se normalizan al modelo canónico de Waylo.
- El chat no persiste mensajes, resultados de tools ni tokens de confirmación.
- La conversación local del frontend guarda solo texto y tarjetas; el token pendiente no
  se serializa en `localStorage`.

## Reglas y limitaciones conocidas

- Una tool no puede leer ni modificar datos de otro paciente: el token de Confianza
  mantiene el alcance institucional.
- Una escritura exige IPS viva; no se usa caché para crear, cancelar o reprogramar.
- La API actual de Confianza no devuelve sede primaria del paciente, tipo de cita,
  nombre del médico ni nombre de sede en la respuesta de citas. Por eso Waylo no los
  inventa. Para crear una cita se requiere `site_id` proveniente del catálogo y la
  herramienta no asume una sede por defecto.
- La API actual de Confianza no acepta `type` en la creación; Waylo lo exige en su
  contrato canónico para mantener la intención de la solicitud, pero el adaptador no lo
  agrega artificialmente al payload institucional.
- La confirmación se invalida al cambiar la acción, sus argumentos, el sujeto o al
  superar cinco minutos.
- Una respuesta inválida de la IPS se transforma en error de tool; el modelo debe
  ofrecer otra fecha o indicar que se contacte a la IPS.

## Riesgos y validación

- Riesgo: el proveedor puede no devolver function calling en todos los modelos o
  gateways. Se conserva el contrato de texto y se normaliza la falla como LLM no
  disponible.
- Riesgo: disponibilidad y creación pueden competir. La IPS sigue siendo la autoridad
  y puede responder `409`; Waylo no reintenta automáticamente una escritura.
- Pruebas unitarias cubren el ciclo de propuesta, confirmación, token firmado y relay.
- Falta validar el flujo conectado con una cuenta Waylo vinculada a Confianza y observar
  la red desde el navegador.
