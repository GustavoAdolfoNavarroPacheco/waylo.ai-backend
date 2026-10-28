# PRD: completar el contrato canónico IPS

**Estado:** implementación en Waylo; brechas de Confianza documentadas
**Propietario:** `waylo.ai-backend`
**Fecha:** 2026-10-27

## Objetivo

Hacer que el `IpsClient` exprese las operaciones del contrato mínimo de Waylo y que
el adaptador Confianza consuma todos los endpoints ya expuestos, sin modificar la API
institucional.

## Alcance

- Activación, paciente, citas y operaciones de escritura ya existentes.
- Catálogos de sedes, servicios y médicos.
- Disponibilidad exacta y búsqueda de primeros cupos mediante el endpoint de
  disponibilidad existente, como fallback del adaptador.
- Historia clínica de solo lectura.
- Documento de confirmación de cita.
- Enriquecimiento de citas con nombres de médico y sede cuando los catálogos lo permiten.
- Mapeo tolerante de futuras variantes de `sex`, `primary_site`, `type` y `site_id`.

## Fuera de alcance

- Cambios en `ConfianzaIPS`.
- Crear endpoints nuevos en la IPS.
- Inventar sede primaria, tipo de cita o datos clínicos ausentes.
- Persistir historia clínica o documentos en Waylo.

## Contrato canónico

El adaptador expone:

`exchangeActivation`, `getPatient`, `earliestAvailability`, `listAvailability`,
`createAppointment`, `listAppointments`, `cancelAppointment`,
`rescheduleAppointment`, `getClinicalHistory`, `getConfirmationDocument`,
`listSites`, `listServices` y `listDoctors`.

Las credenciales y el alcance por paciente siguen siendo responsabilidad del token IPS
guardado cifrado en Waylo.

## Reglas de degradación

- Si Confianza no trae sede primaria, `primarySite` queda en `null` y Waylo no agenda
  silenciosamente en otra sede.
- Si los cupos no traen `site_id`, la búsqueda puede devolver `siteId: null`, pero una
  operación que exige sede debe detenerse o pedir información válida.
- Si Confianza no acepta `type`, Waylo lo exige al solicitar la cita para conservar la
  intención (`general` o `priority`), pero el adaptador no agrega el campo a su payload;
  la cita de respuesta queda con tipo `null` hasta que la IPS lo exponga o Waylo lo pueda
  derivar de una configuración explícita.
- Si historia o comprobante responden `401/403`, el enlace se trata como rechazado por
  la IPS; un error de red se devuelve como indisponibilidad.

## Validación

- Tests del adaptador para catálogos, disponibilidad, primeras opciones, historia,
  documento y escritura de citas.
- Typecheck y build del backend.
- La validación conectada contra Confianza queda pendiente de una cuenta de agente y
  entorno IPS disponibles; no se ejecutan escrituras reales durante los tests.
