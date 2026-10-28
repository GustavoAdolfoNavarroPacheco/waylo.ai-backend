# Feedback: Confianza IPS vs contrato mínimo de Waylo

Comparación de `openapi.json` (Confianza IPS API, v0.1.0) contra `IPS_CONTRATO_MINIMO.md`. Dirigido al equipo de Confianza IPS: con los **3 puntos obligatorios** de abajo, su API cumple el contrato de Waylo. Todo lo marcado **propuesta** es sugerencia — nada se implementa hasta que la institución lo acuerde.

## Estado por operación

| # | Operación canónica | ¿Cumple? | Nota |
|---|--------------------|----------|------|
| 1 | `exchange_activation` | ✅ | `POST /integrations/agent/token` + emisión de códigos |
| 2 | `get_patient` | ⚠️ | Falta `sex` y la sede vinculada → **obligatorios 1 y 2** |
| 3 | `earliest_availability` | ⚠️ | Waylo compone temporalmente consultas por médico y día; sigue faltando el endpoint institucional y `site_id` por cupo |
| 4 | `create_appointment` | ⚠️ | Todo ok salvo `type` → **recomendado 4** |
| 5 | `list_appointments` | ✅ | `type` derivable; doctor/sede se enriquecen con catálogos |
| 6 | `cancel_appointment` | ✅ | `POST .../status` con `status: cancelled` |
| 7 | `reschedule_appointment` | ✅ | `POST .../reschedule` con `starts_at` |
| 8 | `get_clinical_history` | ⚠️ | Waylo ya implementa el adaptador para `/clinical/patients/{id}`; falta verificar acceso conectado con token de agente |
| 9 | `get_confirmation_document` | ✅ | Waylo ya implementa `POST /documents/appointments/{id}/confirmation` |
| 10 | catálogos | ✅ | `/services`, `/sites`, `/doctors` (sin coordenadas: no hacen falta) |

## Obligatorio

### 1. `sex` en `GET /api/v1/patients/me` — **propuesta**

- Campo nuevo: `"sex": "string | null"` (p. ej. `female` / `male` / `other` / `null`).
- **Motivo:** Waylo inyecta el sexo en el contexto y el triaje N0; con vínculo activo no lo saca de ninguna otra parte (el perfil local lo sobreescribe la IPS).
- Sin él, Waylo tendría que preguntarlo en cada conversación.

### 2. Sede vinculada del paciente en `GET /api/v1/patients/me` — **propuesta**

- Campo nuevo: `"site_id": "integer | null"` en la respuesta del paciente (la sede donde se atiende). Aceptable también un objeto `primary_site: { id, name, address, city }`.
- **Motivo:** Waylo agenda N1/N2 **siempre** en la sede del paciente; hoy la API no dice en cuál está. Sin esta relación no se puede crear ninguna cita correctamente (`POST /appointments` exige `site_id`).
- La relación debe vivir en el paciente (o en un `GET` equivalente): `GET /sites` no permite saber en qué sede está cada paciente.

### 3. Disponibilidad "primeros cupos" en `GET /api/v1/availability` — **propuesta**

Hoy: `doctor_id` + `service_id` + `date` **todos obligatorios** → solo sirve para "cupos de un médico en un día concreto". Waylo necesita: *los primeros cupos de un servicio, sin elegir médico ni fecha exacta*.

- **Propuesta A (relajación, sin endpoint nuevo):** `doctor_id` y `date` pasan a opcionales; añadir `from` (date-time, por defecto = ahora) y `limit` (por defecto 10). Con `service_id` solo, devuelve los primeros cupos.
- **Propuesta B (endpoint nuevo):** `GET /api/v1/availability/earliest?service_id&from&limit`.
- **En ambas:** añadir `"site_id": "integer"` a cada cupo (`AvailabilitySlot`). Waylo filtra los de la sede vinculada; sin él, un médico que atiende en varias sedes produce citas ambiguas.
- **Sin cupos → `200` con `[]`** (nunca 404).

## Recomendado

### 4. `type: "general" | "priority"` en crear y listar citas — **propuesta**

- Campo en `AppointmentCreate` y `AppointmentResponse`.
- **Sin él funciona:** Waylo deriva el tipo del `service_id` (según su mapa `service_ids` por IPS) y rellena su modelo igual. Pero las citas de otros servicios quedan como tipo desconocido.

## Verificar sin tocar la spec

- [ ] **Alcance por token:** con el token del agente, `GET /appointments` y `GET /clinical/patients/{patient_id}` solo devuelven datos del paciente del token (403 para otros).
- [ ] **Errores de auth:** token expirado/revocado → 401; paciente inactivo → 401/403. Waylo interpreta ambos = vínculo desactivado.
- [ ] **Timestamps con offset** (RFC 3339) en todos los `date-time`.
- [x] `X-Confianza-Agent-Key` opcional — se envía si la IPS la configura (decisión del cliente).

## Lo que ya cumple sin cambios

- Activación: `document_type + document_number + eps + activation_code` → `access_token` + `expires_in` + `identity.patient_id`.
- Crear cita con sede (`site_id`), motivo y horario ISO; cancelar (`cancelled`); reprogramar (`starts_at`).
- Estados `requested / confirmed / cancelled / completed / no_show` → el adaptador de Waylo los normaliza.
- Comprobante, historia clínica y catálogos de servicios, sedes y médicos.
- Listas vacías en 200.

## Fuente

- `openapi.json` (Confianza IPS API v0.1.0) vs `IPS_CONTRATO_MINIMO.md` (Waylo).
- Los campos y endpoints nuevos están marcados **propuesta**. Las decisiones del cliente (Agent-Key opcional, `site_id` por cupo, historia clínica recomendada) ya vienen aplicadas aquí.
