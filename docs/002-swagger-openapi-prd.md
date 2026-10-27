# PRD: Swagger y contrato OpenAPI exhaustivos

**Estado:** implementado
**Fecha:** 2026-10-27
**Repositorio:** `waylo.ai-backend`

## Problema y objetivo

Swagger muestra llamadas hacia `http://localhost:3001` incluso cuando se consulta
desde un despliegue, y el contrato publicado no corresponde completamente con las
rutas registradas por Fastify. Hay operaciones anunciadas que el servidor no ofrece,
rutas internas implementadas que no aparecen y respuestas/esquemas insuficientes.

El objetivo es que `/docs` y `/docs/json` describan fielmente la API desplegada,
permitan ejecutar solicitudes contra el mismo origen de la documentación y den a
cada operación parámetros, seguridad, cuerpos, respuestas, errores y ejemplos claros.

## Alcance

- Usar el origen actual de Swagger mediante un servidor OpenAPI relativo.
- Documentar todas las rutas REST registradas: health, autenticación, consentimiento,
  vínculo IPS de cuentas legacy, perfil y adaptador IPS interno.
- Describir autenticación por cookie y por `X-Waylo-Internal-Key` separadamente.
- Añadir modelos, ejemplos, códigos de error y descripciones de reglas observadas en
  los handlers y validadores reales.
- Retirar del contrato activo las rutas de chat, hospitales y calendario, y la
  extensión de WebSocket, pues no están registradas en este backend.
- Validar que el documento parsea, se sirve en `/docs/json` y refleja el inventario
  de rutas realmente registradas.

## Enfoque

`docs/waylo-api.openapi.yaml` seguirá siendo la fuente canónica que carga `src/app.ts`.
La documentación describe el comportamiento actual del código; una capacidad futura
se añadirá al contrato cuando su ruta se implemente. El contrato interno IPS conserva
el secreto como nombre de header, nunca su valor.

## Actores e impacto

- Desarrolladores del frontend Waylo y consumidores internos: podrán descubrir y
  probar el contrato desde el host actual.
- Operadores: tendrán una especificación verificable para los despliegues.
- No cambia persistencia, autorización, respuestas ni reglas de negocio de la API.

## Validaciones y riesgos

- Las operaciones que usan cookie requieren que Swagger se abra en el mismo origen
  del backend; el navegador no puede adjuntar una cookie httpOnly a otro host.
- Las operaciones `/internal/*` requieren la clave privada y no deben exponerse a
  llamadas del navegador.
- Los tests con base de datos validan el documento servido; la disponibilidad de la
  base puede limitar la ejecución local de esa suite.
- Un contrato descriptivo no implementa las rutas retiradas ni garantiza que una
  integración externa esté configurada.

## Criterios de aceptación

- Swagger no fija `localhost` y usa el origen desde el que se abre.
- Cada ruta registrada figura en OpenAPI y cada ruta anunciada está implementada.
- Cada operación declara su seguridad, entrada, respuestas de éxito y errores
  relevantes, con esquemas alineados con el handler.
- La documentación identifica límites de seguridad y no publica secretos.
