# Contrato mínimo de la IPS

Qué **toda institución** debe poder satisfacer para conectarse a Waylo. Recordatorio: los contratos reales de cada IPS son heterogéneos (endpoints, auth, headers, bodies distintos) — esto es el **lenguaje canónico** que el adaptador híbrido debe poder mapear a cada uno.

> **Regla:** si una operación obligatoria no puede mapearse, la IPS no puede conectar. Si falla una opcional, Waylo degrada (lo dice cada una). Los paths de abajo son canónicos, no reales.

## Resumen

| # | Operación | Obligatoria | Para qué en Waylo |
|---|-----------|-------------|-------------------|
| 1 | `exchange_activation` | ✅ | Vincular cuenta ↔ IPS (documento + código) |
| 2 | `get_patient` | ✅ | Contexto inyectado + **sede vinculada** |
| 3 | `earliest_availability` | ✅ | Cupos de N1 y N2 (sede fija = la vinculada) |
| 4 | `create_appointment` | ✅ | Crear cita `general` / `priority` |
| 5 | `list_appointments` | ✅ | Pantalla de citas, antifraude, aviso de baja |
| 6 | `cancel_appointment` | ✅ | Tool cancelar |
| 7 | `reschedule_appointment` | ✅ | Tool reprogramar |
| 8 | `get_clinical_history` | ⚠️ recomendada | Inyección de historia clínica (si no: Waylo pregunta en la conversación) |
| 9 | `get_confirmation_document` | ○ opcional | Comprobante de la cita |
| 10 | `list_sites` y catálogos | ○ opcional | Sedes/médicos/servicios (si no: config por IPS + sede embebida en #2) |

## Implementación actual en Waylo

El contrato canónico ya está expresado por `src/modules/ips/types.ts` y `IpsClient`.
El adaptador Confianza implementa activación, paciente, citas, escrituras, catálogos,
disponibilidad exacta, primeros cupos compuestos, historia clínica y comprobante.

La composición de primeros cupos usa temporalmente el endpoint existente por médico y
fecha porque Confianza aún no expone `/availability/earliest`. Es una degradación del
adaptador, no un cambio al contrato canónico. Si el cupo no trae `site_id`, Waylo lo
devuelve como `null` y no lo usa para agendar una sede que no puede verificar.

**Lo que NO es mínimo:** catálogos de médicos, `Idempotency-Key`, coordenadas de sedes (N3/N4 usan la base propia de hospitales), panel de administración, webhooks.

---

## Operaciones obligatorias

### 1. `exchange_activation`
- **Entrada:** `document_type`, `document_number`, `eps?`, `activation_code` (6 dígitos).
- **Salida:** `access_token`, `expires_in`, `patient_id`.
- **Errores:** código inválido o vencido → 401.
- **Nota:** cómo emite la IPS ese código (app, SMS, mostrador) es cosa suya, no del contrato.
- **Waylo guarda** `access_token` **cifrado** en el vínculo hasta que venza; vencido → pide código nuevo. Un 401/403 en cualquier llamada posterior = vínculo → `DEACTIVATED`.

### 2. `get_patient`
- **Salida mínima:** `name`, `sex`, `birth_date`, `eps`, `city` y **`primary_site`** `{ id?, name, address, city, phone? }` — la sede donde el paciente se atiende (de ahí salen N1/N2).
- **Alcance:** solo el paciente del token; otro → 403.
- Sin sede vinculada, N1/N2 no funcionan.

### 3. `earliest_availability`
- **Entrada:** `service_id` (o clave de servicio), `type` (`general`|`priority`), `from?` (def. ahora), `limit?` (def. 3).
- **Salida:** `[{ starts_at, ends_at, doctor_id, doctor_name, site_id }]`, ordenado por `starts_at`. La sede no se pide en la entrada: **Waylo filtra los cupos cuyo `site_id` sea la sede vinculada**.
- **Sin cupos → `[]`** (nunca 404).
- `priority` es **otro tipo de cita** (como `general`) cuya disponibilidad define la IPS: por lo general, mismo día o siguiente. Waylo no impone ventana — pide los cupos más tempranos y muestra lo que la IPS devuelva.

### 4. `create_appointment`
- **Entrada:** `doctor_id`, `service_id`, `site_id` (= sede vinculada), `starts_at` (ISO 8601 con offset), `type` (`general`|`priority`), `reason` (≤500, resumen sin datos de identidad).
- **Salida:** cita creada (`id`, `starts_at`, `status`).
- **Waylo:** solo tras confirmación explícita verificada en el backend. Sin idempotencia: antes de reintentar, consulta `list_appointments`.

### 5. `list_appointments`
- **Salida:** citas del paciente autenticado: `id`, `type?`, `starts_at`, `ends_at?`, `status`, `reason?`, `doctor_name?`, `site { name, address, city }`.
- Estados mínimos a distinguir: **activa** vs `cancelled` / `completed` (la Confianza IPS usa `requested, confirmed, cancelled, completed, no_show` — el adaptador normaliza).
- Nunca devuelve citas de otro paciente (403).

### 6. `cancel_appointment`
- **Entrada:** `id` + estado cancelado (+ `reason?`). Mapeable a cualquier API que lo expresé (endpoint propio, cambio de status o compuesto).

### 7. `reschedule_appointment`
- **Entrada:** `id` + `starts_at` nuevo (+ `reason?`). Mismo criterio de mapeo que #6.

## Recomendada y opcionales

### 8. `get_clinical_history` ⚠️
- **Salida:** resumen clínico del paciente (episodios, condiciones, medicación actual) — **no** el expediente completo: se inyecta al contexto y come tokens.
- **Si no existe:** Waylo compensa preguntando en la conversación. **Decidido: recomendada** — no bloquea el alta de una IPS.

### 9–10. Opcionales
- `get_confirmation_document(id)` → comprobante; sin él, la tool `get_confirmation_document` no se expone.
- `list_sites` / `list_services` / `list_doctors` → si no existen, Waylo usa la sede embebida en #2 y los `service_ids` del registro de la IPS.

---

## Reglas transversales

- **Auth:** el mecanismo lo define cada IPS (`auth_type` + `contract_mapping` en la tabla `ips`); Waylo **no** exige Bearer ni headers concretos. El token nunca sale del backend ni llega al frontend.
- **Alcance:** todo dato = solo del paciente del token (una institución que devuelva datos de otros rompe el contrato).
- **Errores de auth** (401/403/paciente inactivo) → vínculo `DEACTIVATED`, degradación: N0/N3/N4 siguen (base propia de hospitales), N1/N2 piden reactivar.
- **Tiempo:** ISO 8601 con offset en todos los timestamps.
- **Sin cupos, sin citas, sin resultados:** listas vacías, nunca 404.
- **Idempotencia:** no requerida; si la institución soporta `Idempotency-Key`, mejor.

## Mapeo contra la Confianza IPS (OpenAPI de su API)

| # | Operación | Endpoint real | Estado |
|---|-----------|---------------|--------|
| 1 | `exchange_activation` | `POST /integrations/agent/token` | ✅ existe |
| 2 | `get_patient` | `GET /patients/me` | ⚠️ **falta `sex` y la sede vinculada** |
| 3 | `earliest_availability` | `GET /availability/earliest` | ❌ no existe (hoy `/availability` exige médico y fecha; debe traer además `site_id` por cupo) |
| 4 | `create_appointment` | `POST /appointments` | ⚠️ **falta `type`** |
| 5 | `list_appointments` | `GET /appointments` | ✅ existe |
| 6 | `cancel_appointment` | `POST /appointments/{id}/status` | ✅ existe |
| 7 | `reschedule_appointment` | `POST /appointments/{id}/reschedule` | ✅ existe |
| 8 | `get_clinical_history` | `GET /clinical/patients/{id}` | ⚠️ endpoint **existe**; verificar acceso con token de agente |
| 9 | `get_confirmation_document` | `POST /documents/appointments/{id}/confirmation` | ✅ existe |
| 10 | `list_sites` y catálogos | `GET /sites`, `/services`, `/doctors` | ✅ existen (sin coordenadas; no hacen falta) |

**Pendiente con la Confianza IPS:** los cambios que se le pidieron siguen **sin aprobar** (se retoman luego). El desglose de la brecha actual (op. 2 con `sex` y sede, op. 3, `type` recomendado y acceso de la op. 8) con propuestas concretas está en `IPS_CONTRATO_FEEDBACK.md`.
