# Auditoría general de pruebas del backend Waylo

Fecha de corte: 2026-10-29

## Alcance

Se revisaron configuración, contratos de error, dispatch de adaptadores IPS,
estado de vínculos, herramientas de chat, confirmación explícita de citas,
autenticación interna y límites de la suite con Prisma.

## Cambios realizados

- Añadido `npm run test:unit` para ejecutar la suite sin las dos suites que
  requieren PostgreSQL (`auth.test.ts` e `ips-link.test.ts`).
- Las suites de base de datos solo se habilitan cuando `DATABASE_URL` apunta a
  `localhost`, `127.0.0.1` o `::1`. Esto evita que una variable heredada permita
  tocar Neon o una base compartida por accidente.
- Añadidas pruebas unitarias para configuración, contrato de citas, estados de
  vínculo, dispatch de adaptadores y las diez herramientas IPS.
- Añadidas pruebas de argumentos inválidos, confirmación firmada, orden estable
  de argumentos, cancelación explícita y normalización de fallos de la IPS.

## Evidencia local

- `npm run test:unit -- --reporter=dot`: 12 archivos, 39 pruebas aprobadas.
- `npm test -- --reporter=dot`: 39 aprobadas y 18 omitidas por no existir una
  base PostgreSQL local; no se intentó conectar a Neon.
- `npm run typecheck`: correcto.
- `npm run build`: correcto.

La suite completa con PostgreSQL sigue definida en `.github/workflows/ci.yml`:
el runner debe levantar PostgreSQL temporal, aplicar migraciones y ejecutar
las pruebas de autenticación y vínculo. Las pruebas unitarias no sustituyen
esa validación de persistencia.

## Riesgos y pendientes

Todavía no existe un umbral porcentual de cobertura porque el repositorio no
incluye un proveedor de cobertura de Vitest. Conviene añadirlo en un cambio
separado junto con el lockfile y publicar métricas para `src/modules/auth`,
`src/modules/chat` y `src/modules/ips`. La disponibilidad real de Confianza,
LLM, PostgreSQL administrado y Vercel requiere validación operativa fuera de
esta suite.
