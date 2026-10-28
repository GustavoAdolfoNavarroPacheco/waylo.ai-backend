# Waylo: implementación — BD, backend, frontend

Cómo se construye lo decidido en `WAYLO_BACKEND.md`: qué hay en la base de datos, qué hace el backend, qué hace el frontend y cómo se integran. **Este documento no contiene contratos ni DDL**: los contratos de API y las migrations van en archivos aparte (ver tabla inicial).

| Decisión | Valor |
|----------|-------|
| Base de datos | **PostgreSQL** |
| Frontend | **Next.js (React + TypeScript)** — App Router |
| Repos | **Separados:** `waylo-backend` y `waylo-frontend` |
| Contrato de API | `docs/waylo-api.openapi.yaml` en el repo del backend → el frontend genera sus tipos desde ahí |
| Migrations | **Prisma** (`prisma/schema.prisma` + `prisma/migrations/`) en el repo del backend |
| RAG | **pgvector + embeddings con modelo local** (sin API externa de embeddings; se indexa al arrancar) |
| Consentimiento | Tabla `consents`: prueba de la aceptación del aviso (Ley 1581) |

## 1. Mapa de integración

```text
 Navegador (waylo-frontend: Next.js)                Externos
   HTTPS + WebSocket, cookie de sesión                │
       │                                              ├─ Grok (xAI) ── LlmProvider (texto y voz)
       ▼                                              ├─ IPS(es) ───── IpsClient + adaptador híbrido
  waylo-frontend  ⇄  Backend Fastify (Node + TS) ─────┤                   └─ caché de respaldo (PG, TTL)
                             │                        ├─ Google Calendar (solo Waylo → Google)
                             ▼                        ├─ Docs RAG (markdown en repo, por IPS)
                       PostgreSQL                     └─ Base propia de hospitales (seed)
              users · ips · ips_links · sessions · cache · audit · calendar
```

**Regla de oro:** el frontend solo habla con el backend. Nunca ve la clave de xAI ni tokens de la IPS. El backend es el único proceso con secretos.

## 2. Base de datos (PostgreSQL)

El schema y las migrations viven en Prisma (`prisma/schema.prisma`, `prisma/migrations/`). Aquí, el modelo:

| Entidad | Campos clave | Notas |
|---------|--------------|-------|
| `users` | `id`, `email` único, `password_hash`, `created_at` | Cuenta local. Baja = **borrado total** |
| `user_profiles` | `user_id` único, `sex`, `birth_date`, `city` | Datos locales del usuario **sin vínculo** (Waylo los pide para contexto y N0). Al vincular, los campos de la IPS tienen prioridad en `GET /me` |
| `ips` | `id`, `name`, `slug`, `base_url`, `auth_type`, `contract_mapping` (JSONB), `service_ids`, `rag_dir`, `active` | Registro multi-IPS; `contract_mapping` = mitad declarativa del adaptador híbrido |
| `ips_links` | `user_id`, `ips_id`, `document_type`, `document_number`, `patient_id`, `access_token_encrypted`, `token_expires_at`, `status` (active / unlinked / deactivated), `linked_at`, `status_changed_at` | **UNIQUE(user_id):** una IPS activa por cuenta. Token de la IPS cifrado por vínculo. Desactivación por la IPS = UPDATE de `status` cuando un error de auth la delata |
| `sessions` | `id`, `user_id`, `token_hash`, `expires_at` | Sesión de la web app |
| `consents` | `user_id`, `text_version`, `granted_at`, `source` | Prueba de consentimiento (Ley 1581); se conserva seudonimizada tras el borrado |
| `cache_entries` | `ips_id`, `kind` (patient / appointments / sites / clinical), `key`, `value` JSONB **cifrado**, `fetched_at`, `expires_at` | Solo lectura, TTL, claveada por IPS. Es dato de salud: cifrar en reposo |
| `audit_log` | `session_id` seudonimizado, `level`, `reasons`, `red_flags`, `tools`, `model/prompt/rule_versions`, `created_at` | Sin sensibles crudos |
| `calendar_links` | `user_id`, `refresh_token` cifrado, `status` | Fase 5 |
| `rag_chunks` | `id`, `ips_id`, `doc_path`, `chunk_index`, `text`, `embedding vector` (pgvector) | Índice semántico por IPS; se regenera al arrancar o al cambiar los markdown. Modelo de embeddings **local** |
| `hospitals` | `id`, `name`, `lat`, `lng`, `address`, `phone`, `city` | Seed propio (datos abiertos); N3/N4 no depende de la IPS |

- **Extensión:** `pgvector` habilitada en la BD.
- **Índices:** `ips_links(user_id)` único; `cache_entries(ips_id, kind, key)` y `cache_entries(expires_at)`; HNSW sobre `rag_chunks(embedding)`.
- **Borrado total (baja):** `users` + `user_profiles` + `ips_links` + `sessions` + `calendar_links`; el BFF intenta desvincular el `external_ips_link`, lo que borra su caché clínica. Si el backend está temporalmente caído, la caché cifrada expira como máximo en siete días. `audit_log` y `consents` quedan **seudonimizados** como prueba de cumplimiento (supuesto, validar con el abogado).
- Lo que la IPS provee y Waylo no guarda maestro: historia clínica y sede vinculada → viven en la IPS y en la caché temporal, nunca como espejo editable.

## 3. Backend (`waylo-backend`)

**Módulos (carpetas):** `api/` · `auth/` · `conversation/` · `safety/` · `triage/` · `tools/` · `ips/` (modelo canónico + adaptador) · `llm/` · `rag/` · `hospitals/` · `calendar/` · `audit/` · `config/` · `tests/`.

**API interna (resumen; contrato exacto en `docs/waylo-api.openapi.yaml`):**

| Grupo | Rutas |
|-------|-------|
| Cuentas | `POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `DELETE /auth/account` (borrado total; devuelve las citas vigentes para el aviso previo). **Sin** recuperación de contraseña ni verificación de email en el MVP |
| Consentimiento | `POST /consent` (acepta la versión vigente del aviso; se persiste en `consents`) |
| Vínculo IPS | `POST /ips/link` (documento + código de 6 dígitos) · `DELETE /ips/link` (desvincular) · `GET /ips/link` (estado) |
| Perfil | `GET /me` (datos locales + de la IPS según vínculo; cada campo con `source`: `local` o `ips`) |
| Citas (lectura) | `GET /appointments` (IPS o caché; `stale: true` si la IPS está caída) |
| Hospitales | `GET /hospitals/nearby?lat&lng&city` |
| Calendario (fase 5) | `POST /calendar/connect` (OAuth) · `DELETE /calendar/connect` |
| Chat y voz | `WS /ws/chat` |

**Eventos `WS /ws/chat`:**

| Dirección | Evento | Contenido |
|-----------|--------|-----------|
| ↑ cliente | `message` · `audio_chunk` (binario) · `interrupt` · `voice_start` / `voice_stop` | entrada del usuario |
| ↓ server | `message_delta` · `transcript` (parcial y final) · `audio_chunk` | streaming de texto y voz |
| ↓ server | `level_detected` (nivel + razones) · `tool_status` (en curso / listo / error) · `red_flag` | estado clínico y tools |
| ↓ server | `link_degraded` · `stale_context` · `llm_down` | degradaciones: vínculo inactivo, IPS caída, Grok caído |

**Flujo de un mensaje:** WS → auth de sesión → `safety.check` (red flags determinísticas, sin IA; si salta → N3/N4 directo, sin Grok) → orquestador → Grok con contexto (perfil inyectado + RAG de la IPS) → si Grok pide una tool → validación Zod + **confirmación explícita del usuario si es destructiva** → adaptador de la IPS (lecturas: caché si la IPS no responde; escrituras: exigen IPS viva) → `audit_log` → respuesta al cliente.

## 4. Frontend (`waylo-frontend`)

- **Next.js con App Router:** todo lo conversacional (chat, voz, estados en vivo) vive en **componentes cliente**; el SSR/SSG de Next se aprovecha en páginas públicas (landing, login, registro) y en el primer render.
- **Pantallas:** `/registro` · `/login` · `/vincular` (documento + código) · consentimiento (modal en la primera visita) · `/chat` (principal) · `/citas` (lectura) · `/ajustes` (datos, vínculo IPS, calendario, baja).
- **Emergencia:** botón fijo `tel:` a `EMERGENCY_PHONE` **en todas las pantallas**.
- **Componentes clave:** `Transcript` (transcripción en vivo), `VoiceControls` (micrófono, interrumpir), `LevelBadge` (N0–N4), `AppointmentCard`, `LinkBanner` (vínculo desactivado → reactivar), `DegradedBanner` (IPS caída → modo caché), `EmergencyButton`.
- **Datos:** tipos **generados** desde el OpenAPI del backend en CI — nada de tipos escritos a mano.
- **Estado:** WS con reconexión automática y estados visibles: "escribiendo…", "escuchando…", "consultando tu cita…".

## 5. Cómo se integra

- **Contrato único entre repos:** el backend publica `waylo-api.openapi.yaml`; el frontend lo consume en CI. Cambio de API = PR que rompe la compilación si no se regenera.
- **Sesión:** cookie `httpOnly` en REST y la misma cookie al abrir el WS. CORS solo con el origin del frontend. Rate limit por usuario.
- **Degradación en cadena:**

| Fallo | Backend hace | Frontend muestra |
|-------|--------------|------------------|
| IPS caída | Lecturas desde caché (`stale: true`); escrituras rechazadas | Banner "mostrando datos guardados"; al agendar: "no podemos agendar ahora" |
| Vínculo desactivado/desvinculado | `link_degraded`; N1/N2 bloqueadas | `LinkBanner` con aviso; N0/N3/N4 siguen disponibles |
| Grok caído | `llm_down`, sin tools | Mensaje claro + llamar a la IPS o a emergencias |

- **Secretos solo en el backend:** `XAI_API_KEY`, `LLM_BASE_URL`, secretos por IPS, `DATABASE_URL`, Google OAuth.

## 6. Supuestos y pendientes (validar)

- [x] Escrituras de cita (crear/cancelar/reprogramar) **solo desde el chat** vía tools; `/citas` es lectura y sus botones retoman la conversación. **Decidido:** sin rutas REST de escritura.
- [ ] `audit_log` se conserva **seudonimizado** tras el borrado de cuenta.
- [ ] Nombres/org de los repos (`waylo-backend`, `waylo-frontend`).
- [ ] Fuente y formato del seed de hospitales (datos abiertos del Estado, sin confirmar).
- [ ] Next.js es **solo frontend**: sus API routes y server actions **no** implementan lógica de negocio ni tocan la BD — todo vive en `waylo-backend` (evita duplicar endpoints y secretos).
