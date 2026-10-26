# agent.md: objetivo

Eres una IA que toma el relevo. Tu trabajo **no es construir Waylo**: es **preguntarle al dueño y mantener dos listas cortas y exactas**:

1. **Qué cambia en la API de la IPS** → brecha detallada en `IPS_CONTRATO_MINIMO.md`
2. **Qué se construye en Waylo** → en `WAYLO_BACKEND.md`

Habla en español, tono cercano y directo. El dueño no quiere documentos largos: quiere **información puntual** que se lea en un minuto.

---

## Reglas de edición

- **Nada de párrafos largos.** Tablas cortas, checklists `- [ ]`, una idea por línea.
- **Si un documento pasa de ~150 líneas, recórtalo** sin perder los contratos ni las listas.
- **Cada respuesta del dueño se aplica en el momento:** reemplaza la suposición, borra la pregunta contestada y actualiza **ambos** `.md` si el cambio afecta a los dos.
- **No inventes endpoints ni campos.** Si no está en el contrato mínimo ni en el OpenAPI de la institución, es una propuesta y se marca como tal.
- **No des por validada ninguna regla clínica.** Niveles, red flags y mensajes de emergencia necesitan un médico.
- **Pregunta de a pocas:** máximo 3 por turno, con opciones, empezando por las bloqueantes.
- Al terminar cada turno, resume en 5 líneas: qué cambió, qué falta, qué sigue.

---

## Qué es Waylo (lo mínimo)

IA que según los síntomas dice a qué nivel acudir y ejecuta la acción en la IPS: **cita general (N1)**, **cita prioritaria (N2)** o **sede de urgencias más cercana (N3/N4)**, con autocuidado en N0. Texto y voz, cerebro = **Grok (xAI)**. Backend **Node.js + TypeScript (Fastify + Zod + Vitest)**. La API de la IPS es "Confianza IPS" (FastAPI, OpenAPI).

**No hace:** diagnosticar, recetar, dar dosis ni tocar historia clínica.

---

## Ya decidido (no lo vuelvas a preguntar)

| Tema | Decisión |
|------|----------|
| Destinatario de la docs | Un agente de código que construirá Waylo |
| Stack | Node.js + TypeScript (Fastify + Zod + Vitest) |
| Estilo | Markdown informal, "qué hay que hacer" |
| Sede más cercana | La calcula Waylo (Haversine) con el endpoint de sedes |
| Prioritaria | Lo más pronto posible por dolencia aguda |
| Separación | Cambios de la IPS aparte de lo que se construye en Waylo |
| Fuente de verdad | Los `.md` de este repo (el ERS de claude.ai está obsoleto) |

### Decisiones del sistema (definición en curso)

| Tema | Decisión |
|------|----------|
| Triage N0–N4 + red flags | **Es el núcleo del producto.** No es solo una app de citas |
| Cuenta de Waylo | Cuenta **local (email + contraseña)**. Se crea con Sign **Up**, se entra con Log In. El usuario de la IPS la **vincula** con documento + código de activación de la IPS |
| RAG | Documentos markdown con **contexto de la IPS** (qué es, servicios, cómo funciona). No es RAG clínico |
| Historia clínica | **Solo lectura**: se lee de la IPS y se inyecta a la conversación. Waylo **no guarda copia local** ni la escribe |
| Datos del usuario | Se sincronizan desde la IPS (nombre completo, sexo, fecha de nacimiento, sede vinculada) y se inyectan a Waylo como contexto |
| Tools / MCP | **Solo function calling** (las tools de Grok). MCP descartado por ahora; analizado y puede revisitarse si aparece un cliente MCP real |
| Cliente | **Web app** (WebSocket para texto y voz) |
| Google Calendar | **Un solo sentido: Waylo → Google**, con consentimiento explícito y campos mínimos (título, fecha, sede) |
| Proveedor IA | `baseUrl` y `apiKey` parametrizados en variables de entorno (`LlmProvider` ya abstrae) |
| Sincronización | **En vivo + caché persistente de respaldo** (solo lectura, TTL, cifrado): si la IPS falla, Waylo responde desde caché; crear citas exige IPS viva |
| Sede de la cita (N1/N2) | **Siempre la sede vinculada** del paciente; el usuario no elige |
| Emergencias (N3/N4) | **Base propia de hospitales de Colombia** con coordenadas (fuente propuesta: datos abiertos), sin depender de la IPS. Distinto de la sede vinculada |
| Uso sin vínculo IPS | **Permitido.** Waylo pide fecha de nacimiento y sexo para contexto; al vincular, los datos de la IPS **sobreescriben** los locales. N1/N2 exigen vínculo |
| Borrado de cuenta | **Borrado total** en Waylo, con aviso de citas vigentes (no se cancelan) |
| RAG operación | Markdown en el repo, indexado al arrancar |
| MVP | **Completo con voz** (fases 0–5 incluyen speech-to-speech y Google Calendar en fase 5) |
| Multi-IPS | **Desde el inicio.** Unidad = institución prestadora (IPS física). Config por IPS en BD (URL, service_ids, carpeta RAG, mapeo de contrato); secretos por institución. **Una IPS activa por cuenta** |
| Contratos heterogéneos | **Modelo canónico interno de Waylo + adaptador híbrido por IPS**: mapeo declarativo en BD (endpoints, métodos, auth, headers, parámetros, bodies, extracción de campos) + override en código cuando la institución lo necesite. Confianza IPS = primer adaptador y mock |
| Desvinculación | **Bidireccional:** el usuario desvincula su cuenta; la IPS desactiva al usuario. Detectada por error de auth (401/403 o paciente inactivo) en cualquier llamada → vínculo inactivo + aviso + degradación (N0/N3/N4 siguen; N1/N2 piden reactivar). Citas vigentes: visibles con aviso, no gestionables. La cuenta local no se borra |
| Base de datos | **PostgreSQL** (cifrado en reposo para caché y tokens; borrado total de cuenta = users + vínculos + sesiones + caché + calendar) |
| Frontend | **Next.js (React + TypeScript)** |
| Repos | **Separados:** [waylo.ai-backend](https://github.com/GustavoAdolfoNavarroPacheco/waylo.ai-backend) y [waylo.ai](https://github.com/GustavoAdolfoNavarroPacheco/waylo.ai). La IPS de integración es [confianza-ips-frontend](https://github.com/Duran24062005/confianza-ips-frontend). Fuente compartida de tipos = `docs/waylo-api.openapi.yaml` (publicado por el backend, consumido en CI por el frontend) |
| Doc de implementación | `WAYLO_IMPLEMENTACION.md` (BD, backend, frontend e integración). **Contratos y migrations en archivos aparte**, nunca embebidos en el markdown |
| ORM | **Prisma**: schema en `prisma/schema.prisma`, migraciones con `prisma migrate` |
| Motor del RAG | **pgvector + embeddings con modelo local** (se indexan los markdown por IPS al arrancar; cero API externa de embeddings) |
| Política de cuenta (MVP) | **Sin recuperación de contraseña ni verificación de email** — riesgo aceptado: si olvida la contraseña, la cuenta (y su vínculo) quedan varadas |
| Consentimiento | **Tabla `consents`** (user_id, versión del texto, granted_at): prueba de Ley 1581; se conserva seudonimizada tras el borrado |
| Cita prioritaria | **Otro tipo de cita** (`type: priority`), no una ventana: la disponibilidad la define la IPS (por lo general, mismo día o siguiente). Waylo pide los primeros cupos, sin imponer límite |
| service_ids N1/N2 | Se **descubren** al configurar la IPS: `GET /services` identifica "Medicina general" y "Atención prioritaria"; los IDs viven en `ips.service_ids` (nada hardcodeado) |
| Disponibilidad y sede | La disponibilidad trae **`site_id` por cupo**; Waylo filtra los de la sede vinculada. No se exige vínculo médico ↔ sede |
| Agent-Key Confianza | **Opcional** (`required: false` en el contrato actual); Waylo la envía si la IPS la configuró. La key vive en config/secretos por institución |
| Cliente MVP | **Solo web responsiva** (Next.js). Sin WhatsApp ni app móvil en el MVP |
| Menores | **Solo mayores**: el MVP es únicamente el paciente autenticado; Waylo no gestiona (ni comenta) terceros |
| Retención de conversaciones | **Nada tras cerrar la sesión**: sin audio y sin historial de chat; `audit_log` guarda nivel/flags/tools (trazabilidad clínica), nunca contenido |
| Presupuesto de voz | Voz en MVP **con tope mensual**; superado el tope, degrada a solo texto con aviso |
| Números de urgencia | **Configurables por país**: número de emergencias + línea de salud mental; ni hardcodeados ni por IPS |
| Validación clínica | **Grok valida por ahora** niveles, red flags y casos. Un médico debe revisarlos antes de producción (pendiente) |
| Horario de urgencias | **Sin horario**: la tarjeta muestra solo lo verificable (nombre, dirección, teléfono, distancia) |
| Autorizaciones EPS | **No en el MVP**: solo citas de médico general y prioritarias |
| Despliegue MVP | **VPS + Docker Compose** (Postgres + backend + frontend); WS en un solo proceso, aguanta cientos de usuarios |
| Historia clínica | En el contrato mínimo: **recomendada** — no bloquea el alta de una IPS; si no existe, Waylo pregunta en la conversación |
| Escrituras de cita | **Solo chat** vía tools; REST de citas = solo lectura (ya no es supuesto §6) |
| Sin cupos | Muestra **lo más lejano disponible** con aviso de la fecha; si no hay ninguno, aviso claro y sugerir reintentar |
| Ubicación N3/N4 | **Pedir GPS** → si se deniega, ciudad del perfil → desde el chat también se puede buscar atención en **otra ciudad** (`?city`) |

---

## Estado actual (verificado contra el OpenAPI)

- Los cambios pedidos a la Confianza IPS fueron **8** (6 bloqueantes, 2 deseables), todos sobre huecos reales de su OpenAPI. El documento ya no está en el repo.
- **Decidido (IPS):** cambio 9 → la disponibilidad trae **`site_id` por cupo** (lo agrega la IPS) y Waylo filtra los de la sede vinculada; no hace falta vínculo médico ↔ sede.
- **Decidido (IPS):** `X-Confianza-Agent-Key` **opcional** como en el contrato actual (`required: false`); Waylo la envía si la IPS la configuró.
- **Decidido (IPS):** los `service_id` de N1/N2 se **descubren** al configurar la IPS: `GET /services` → identifica "Medicina general" y "Atención prioritaria" → IDs en `ips.service_ids` (nada hardcodeado).
- **Pendientes de definir (sistema):** ~~cerrados~~ → sistema definido: cuentas, vínculo IPS, RAG, sincronización en vivo + caché, sede vinculada vs hospitales, baja total, MVP con voz.
- **Cambios de la IPS:** congelados por el dueño y **sin aprobar aún** — decisión: se retoman luego (el documento original salió del repo).
- **Contrato mínimo de la IPS:** `IPS_CONTRATO_MINIMO.md` — 7 operaciones canónicas obligatorias (activación, paciente+sede, primeros cupos, crear/listar/cancelar/reprogramar), 1 recomendada (historia clínica), 2 opcionales, reglas transversales y mapeo contra la Confianza IPS. Es la referencia para retomar los cambios con la institución. `ips_links` gana `access_token_encrypted` + `token_expires_at`.
- **Fase 0 implementada** (2026-10-24): backend Fastify + TS estricto + Zod + Prisma + Vitest en marcha — cuentas (register/login/logout/baja total con aviso de citas que quedan en la IPS), consentimiento seudonimizado (HMAC), `GET /me` fusionado local↔IPS con `source` por campo, vínculo IPS con adaptador por `contract_mapping.adapter` (mock acepta código `123456`; confianza contra su OpenAPI v0.1.0), token de la IPS cifrado (AES-256-GCM en `ips_links.access_token_encrypted`), registro multi-IPS (`ips_id` opcional; obligatorio si hay >1 activa), `npm run seed:ips` (mock activo + confianza inactivo). 25 tests ✓ (auth, vínculo, crypto).
- **Entorno local:** `docker compose up -d` levanta PostgreSQL 16 + pgvector (`127.0.0.1:5434`) y el API (`127.0.0.1:3001`). La migración crea `rag_chunks` si pgvector está disponible (guard `DO/EXCEPTION`): en local sin pgvector se omite, en la imagen de producción se crea completo. Tests de integración: `DATABASE_URL=<url de la BD de pruebas> npm test`. Guía completa en `TESTING_SETUP.md`.
- **Contrato actualizado** (`docs/waylo-api.openapi.yaml`): códigos `UNAUTHORIZED`/`NOT_FOUND` en el enum de errores; `ips_id` opcional en `POST /ips/link`.
- **Despliegue listo** (2026-10-24): `Dockerfile` multi-stage (node:24-slim + `openssl` — sin él Prisma elige el engine mal y da P1001 —; `prisma migrate deploy` corre al arrancar), `docker-compose.yml` (`db` pgvector:pg16 solo interno + `api` + `caddy` con HTTPS automático tras `--profile https`), `Caddyfile`, `.dockerignore` y `deploy.md`. En prod la imagen trae pgvector → se crea `rag_chunks` completo. `prisma` CLI movido a `dependencies` (lo usa el contenedor). Validado en local: stack docker corriendo.
- **Swagger UI** (2026-10-24): `/docs` sirve el contrato canónico `docs/waylo-api.openapi.yaml` tal cual (`@fastify/swagger` + `@fastify/swagger-ui`); JSON en `/docs/json`. El YAML sigue siendo la única fuente de verdad.
- **Entorno de testeo local** (2026-10-24): documentado en `TESTING_SETUP.md`. Stack completo en marcha: Fastify API en `:3001` (Docker Compose), PostgreSQL 16 pgvector en `:5434`, Next.js en `:3000`. Probado registro, login, triage con Grok 4.6 y red flags. Todos los tests pasan (27 backend, 384 frontend).
- **Siguiente hito:** Fase 1 (IPS en vivo: caché de respaldo `cache_entries`, `GET /appointments` con `stale`, degradación, descubrimiento de `service_ids` vía `GET /services`). Chat/WS = Fase 2.

---

## Preguntas para el dueño

**Bloqueantes:** ~~ninguno~~ — las 4 se respondieron (service_ids por descubrimiento, `site_id` en disponibilidad, Agent-Key opcional, CAMBIOS se retoman luego sin aprobarse).

**Después:** ~~ninguna~~ — todas respondidas: cliente solo web responsiva; solo mayores sin terceros; nada se guarda tras cerrar la sesión; voz con tope mensual; números de urgencia por país; validación por Grok por ahora (médico antes de producción); sin horario de urgencias; sin autorizaciones EPS; despliegue VPS + Docker Compose.

**Pendiente (nueva):** no existe endpoint para escribir el perfil local (sexo/fecha de nacimiento/ciudad) sin vínculo → ¿crear `PUT /me` (propongo: `sex`, `birth_date`, `city`) o rellenar por chat cuando exista el WS? Sin eso, `GET /me` sin vínculo sirve todos los campos en null.

---

## Huecos que hay que ir cubriendo (preguntas nuevas)

- Si el usuario puede pedir hablar con una persona.
- Mensajes exactos de N3 y N4, aprobados por un médico.
- Cómo se mide si Waylo acierta: qué se registra y quién lo revisa.

---

## Qué NO debes hacer

- Del código: del backend **sí**, por fases según `WAYLO_IMPLEMENTACION.md`; de la IPS no — adapta solo su OpenAPI actual, no inventes endpoints.
- No presentes la normativa (Ley 1581 de 2012) como asesoría jurídica.
- No metas datos personales reales en los ejemplos.
- No alargues los documentos: si algo se puede decir en una tabla, dilo en una tabla.
