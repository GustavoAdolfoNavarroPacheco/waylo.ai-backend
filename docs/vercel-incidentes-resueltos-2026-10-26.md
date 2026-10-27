# Incidentes de despliegue y runtime resueltos en Vercel

**Fecha de la intervención:** 26 de octubre de 2026
**Repositorio afectado:** "waylo.ai-backend"
**Proyecto Vercel inspeccionado:** "waylo-ai-backend"
**Estado al cierre de la intervención:** Preview y Production respondían correctamente en "/health" y "/docs/json".

Este documento registra la investigación y las correcciones aplicadas a los
errores observados en Vercel durante esta sesión. Incluye la evidencia de los
logs, los comandos ejecutados mediante Vercel CLI, los cambios de código y
configuración, las validaciones realizadas y los riesgos operativos que aún
requieren atención.

## 1. Resumen ejecutivo

Se resolvieron dos fallos independientes de ejecución:

1. Vercel no encontraba un handler HTTP válido en "src/app.js" porque la
   aplicación únicamente exponía un "buildApp" nombrado y el servidor local
   arrancaba desde "src/server.ts".
2. Después de corregir la entrada HTTP, la función fallaba al cargar Swagger
   UI por una incompatibilidad CommonJS/ESM entre "@fastify/static" y
   "content-disposition" bajo Node.js 24.

También se corrigieron dos condiciones de despliegue necesarias para validar
el runtime:

- La configuración inicial de "vercel.json" usaba un bloque "functions" que no
  correspondía con la detección Fastify del proyecto.
- Las variables "APP_SECRET" e "IPS_TOKEN_KEY" de Preview/Production tenían
  valores con formato inválido o se habían creado inicialmente sin marcarse
  como sensibles. Fueron rotadas sin registrar sus valores en este documento.

La verificación final produjo respuestas funcionales:

~~~text
GET /health     200  {"status":"ok"}
GET /docs/json  200  OpenAPI 3.1.0
GET /           404  {"error":{"code":"NOT_FOUND","message":"Ruta no encontrada"}}
~~~

El 404 de "/" es intencional: la API no define una ruta raíz. No representa
el fallo de inicialización que aparecía al principio.

## 2. Síntoma original reportado por Vercel

Los logs recibidos mostraban repetidamente el mismo error para "/",
"/favicon.ico" y "/favicon.png":

~~~text
Invalid export found in module "/var/task/src/app.js".
The default export must be a function or server.
Node.js process exited with exit status: 1.
~~~

El proceso terminaba antes de atender cualquier ruta. Por ello los requests
del navegador o del monitor de Vercel provocaban nuevas invocaciones fallidas,
pero no constituían errores independientes.

## 3. Contexto confirmado del proyecto en Vercel

La inspección mediante CLI identificó los siguientes datos:

| Campo | Valor observado |
| --- | --- |
| Proyecto | "waylo-ai-backend" |
| Project ID | "prj_F4KNmURhYQaeptSAG189MnYBAMF2" |
| Team/scope | "alexisdurangomez588-gmailcoms-projects" |
| Plan | Hobby |
| Framework detectado | Fastify |
| Node.js configurado | "24.x" |
| Root Directory | raíz del repositorio ("null" en la inspección) |
| Alias de producción observado | https://waylo-ai-backend-zeta.vercel.app |
| Repositorio Git configurado en Vercel | "Duran24062005/waylo.ai-backend" |
| Remote del checkout local | "GustavoAdolfoNavarroPacheco/waylo.ai-backend.git" |

La diferencia entre el repositorio conectado a Vercel y el remote del checkout
local es un riesgo importante: un despliegue manual puede contener la
corrección mientras un despliegue automático futuro, originado en el otro
repositorio, podría volver a usar código anterior.

## 4. Causa raíz del error de exportación

Antes de la corrección, "src/app.ts" era una fábrica de Fastify con este
contrato conceptual:

~~~ts
export async function buildApp(deps: AppDeps): Promise<FastifyInstance>
~~~

El arranque local estaba separado en "src/server.ts", que construía la app y
ejecutaba "app.listen()". Ese diseño era suficiente para el proceso local o
VPS, pero Vercel detectó "src/app.ts" como la entrada Fastify y esperaba que
el módulo exportara por defecto una función o un servidor HTTP.

Por tanto, el problema no era una ruta concreta ni el favicon: era el contrato
de entrada que Vercel intentaba cargar. El mensaje menciona "src/app.js"
porque es la ruta compilada/runtime que Vercel reporta dentro de
"/var/task"; el origen TypeScript del módulo era "src/app.ts".

## 5. Corrección de la entrada HTTP

Se mantuvo "buildApp(deps)" como export nombrado para no romper los tests ni
el arranque local y se agregó un handler por defecto compatible con Vercel:

~~~ts
let vercelAppPromise: Promise<FastifyInstance> | undefined;

function getVercelApp(): Promise<FastifyInstance> {
  vercelAppPromise ??= (async () => {
    const app = await buildApp({ config: loadConfig(), prisma: createPrisma() });
    await app.ready();
    return app;
  })();

  return vercelAppPromise;
}

export default async function vercelHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const app = await getVercelApp();
  app.server.emit('request', request, response);
}
~~~

La promesa singleton evita reconstruir la aplicación y crear un
"PrismaClient" en cada invocación cuando Vercel reutiliza una instancia
caliente. El servidor local continúa siendo responsabilidad de "src/server.ts".

También se añadió una prueba de contrato:

~~~ts
import vercelHandler from '../src/app';

describe('Vercel entrypoint', () => {
  it('exports a default HTTP handler', () => {
    expect(vercelHandler).toBeTypeOf('function');
  });
});
~~~

## 6. Configuración Vercel aplicada

La configuración final de "vercel.json" es:

~~~json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "fastify",
  "buildCommand": "npm run prisma:generate && npm run build"
}
~~~

Durante la investigación se probaron dos configuraciones que fueron
descartadas.

### 6.1 "includeFiles" como arreglo

La primera variante intentó declarar "src/app.ts" dentro de
"functions.src/app.ts.includeFiles" como arreglo. Vercel rechazó el archivo:

~~~text
Invalid vercel.json - functions.src/app.ts.includeFiles should be string..
~~~

### 6.2 "functions" apuntando a "src/app.ts"

Después se cambió "includeFiles" a un patrón string, pero Vercel indicó que
esa función no estaba dentro de "api":

~~~text
The pattern "src/app.ts" defined in functions doesn't match any Serverless
Functions inside the api directory.
~~~

La solución fue eliminar el bloque "functions" y dejar que la detección
"framework: "fastify"" use el entrypoint Fastify soportado por Vercel. Esta
configuración coincide con el handler por defecto agregado en "src/app.ts".

El ".vercelignore" final excluye artefactos que no deben viajar al despliegue:

~~~text
.git
.github
.vercel
node_modules
dist
coverage
test
Dockerfile
docker-compose.yml
Caddyfile
.env
.env.*
!.env.example
*.log
~~~

La exclusión de ".env" evita empaquetar credenciales locales y la excepción de
".env.example" conserva la referencia no sensible para configuración.

## 7. Segundo error: incompatibilidad de Swagger UI con Node.js 24

Una vez resuelto el export, el Preview podía construir el proyecto, pero la
función fallaba durante el arranque. El log obtenido con "vercel logs" fue:

~~~text
Error [ERR_REQUIRE_ESM]: require() of ES Module
/var/task/node_modules/content-disposition/dist/index.js from
/var/task/node_modules/@fastify/static/index.js not supported.
~~~

El error ocurría dentro de "@fastify/static", dependencia transitiva de
"@fastify/swagger-ui". La cadena observada antes del ajuste era:

~~~text
@fastify/swagger-ui@6.1.2
└── @fastify/static@10.1.7
    └── content-disposition@3.0.0
~~~

En el runtime de Vercel, Node.js 24 intentaba cargar el paquete ESM mediante
"require()". Eso hacía que la función terminara antes de responder incluso a
"/health".

La corrección aplicada en "package.json" fue fijar una versión compatible:

~~~json
{
  "overrides": {
    "@fastify/static": "10.1.0"
  }
}
~~~

Después de regenerar "package-lock.json", la resolución local quedó así:

~~~text
@fastify/swagger-ui@6.1.2
└── @fastify/static@10.1.0 overridden
    └── content-disposition@2.0.1
~~~

El override debe conservarse mientras no se valide una versión posterior de
"@fastify/static" y su cadena de dependencias directamente en un Preview de
Vercel/Node.js 24.

## 8. Interacción con Vercel mediante CLI

Todas las operaciones se dirigieron explícitamente al proyecto y scope
correctos. Los valores de autenticación no forman parte de este registro.

### 8.1 Identidad y descubrimiento del proyecto

Se ejecutaron comandos de lectura para confirmar la sesión, el equipo y el
proyecto antes de desplegar:

~~~bash
XDG_CACHE_HOME=/tmp/waylo-vercel-cache \
VERCEL_DISABLE_UPDATE_CHECK=1 \
vercel whoami --format json

vercel project ls \
  --scope alexisdurangomez588-gmailcoms-projects \
  --format json

vercel project inspect waylo-ai-backend \
  --scope alexisdurangomez588-gmailcoms-projects \
  --format json
~~~

La inspección confirmó "framework: Fastify", Node.js "24.x", la raíz del
proyecto y el alias de producción. La lista de proyectos confirmó que
"waylo-ai-backend" era el objetivo y no "waylo.ai", "ConfianzaIPS" u otro
proyecto del workspace.

### 8.2 Despliegues, inspección y logs

Para localizar el despliegue y leer su estado se usaron:

~~~bash
vercel list waylo-ai-backend \
  --scope alexisdurangomez588-gmailcoms-projects \
  --status READY \
  --format json

vercel inspect <deployment-url> \
  --scope alexisdurangomez588-gmailcoms-projects \
  --format json

vercel logs <deployment-url> \
  --scope alexisdurangomez588-gmailcoms-projects \
  --since 2h \
  --limit 100 \
  --json
~~~

La consulta de logs permitió separar los dos incidentes: primero el export
inválido y luego "ERR_REQUIRE_ESM". Los logs también confirmaron que el fallo
se producía al iniciar la función y no por una respuesta de negocio de una
ruta específica.

La secuencia de despliegues observada fue:

| Artefacto | Resultado |
| --- | --- |
| "waylo-ai-backend-ckt6m76jz.vercel.app" | Preview bloqueado por permisos del autor del commit. |
| "waylo-ai-backend-f3966g08f.vercel.app" | Preview construido, pero con "ERR_REQUIRE_ESM" al invocar la función. |
| "waylo-ai-backend-e10gbctdu.vercel.app" | Preview final corregido, estado "READY". |
| "waylo-ai-backend-hv9trj0b9.vercel.app" | Resultado de una promoción inicial; Production aún conservaba variables inválidas. |
| "waylo-ai-backend-72yacqldm.vercel.app" | Production final corregido, estado "READY", con alias de producción. |

Para crear el Preview se usó también la variante JSON de la CLI:

~~~bash
vercel deploy --yes \
  --target preview \
  --project waylo-ai-backend \
  --scope alexisdurangomez588-gmailcoms-projects \
  --json
~~~

### 8.3 Limitación inicial de la CLI

La primera ejecución de Vercel CLI intentó escribir actualizaciones en:

~~~text
/home/alexi-dg/.cache/com.vercel.cli/package-updates/
~~~

El entorno la rechazó con un error de filesystem de solo lectura ("EROFS").
Para continuar sin modificar esa ubicación se usó:

~~~bash
XDG_CACHE_HOME=/tmp/waylo-vercel-cache
VERCEL_DISABLE_UPDATE_CHECK=1
~~~

Después, algunas consultas de red fueron bloqueadas por el sandbox. Se
repitieron como operaciones de lectura con permisos de red autorizados. Esto
era una limitación del entorno de herramientas, no un error de la aplicación ni
de Vercel.

### 8.4 Bloqueo de Preview por autor del commit

Un despliegue de Preview desde el checkout Git local creó un deployment, pero
quedó bloqueado con este mensaje:

~~~text
The deployment was blocked because the commit author doesn’t have permission
to create deployments for this project.
~~~

La causa fue la combinación del plan Hobby, un repositorio privado y un autor
de commit que no tenía autorización para crear despliegues en el proyecto.

Para validar el artefacto sin cambiar la integración Git se preparó una copia
temporal del backend sin ".git", "node_modules", "dist" ni ".env", y se publicó
como despliegue manual:

~~~bash
vercel deploy <temporary-source-dir> \
  --yes \
  --target preview \
  --project waylo-ai-backend \
  --scope alexisdurangomez588-gmailcoms-projects
~~~

Este procedimiento permitió probar el código local corregido sin atribuir el
despliegue a un commit no autorizado.

### 8.5 Variables de entorno y diagnóstico de configuración

Se revisaron únicamente los nombres y entornos con:

~~~bash
vercel env ls production \
  --project waylo-ai-backend \
  --scope alexisdurangomez588-gmailcoms-projects \
  --format json

vercel env ls preview \
  --project waylo-ai-backend \
  --scope alexisdurangomez588-gmailcoms-projects \
  --format json
~~~

Al ejecutar "vercel env run" desde el checkout que contenía ".env", los
valores locales podían mezclarse con el diagnóstico. Por eso se repitió la
comprobación desde la copia temporal sin ".env" local. Esa segunda comprobación
confirmó, sin imprimir valores secretos:

- "DATABASE_URL" presente y con esquema PostgreSQL.
- "CONFIANZA_BASE_URL" con URL válida.
- "APP_SECRET" presente, pero inicialmente con 21 caracteres; el backend
  exige al menos 32.
- "IPS_TOKEN_KEY" presente, pero inicialmente no era una cadena hexadecimal de
  64 caracteres; el backend exige exactamente 64 caracteres hexadecimales.

Los valores inválidos se rotaron para Preview y Production. La primera
actualización se hizo mediante "vercel env update", y la CLI advirtió que el
valor se había almacenado como configuración y recomendó volver a ejecutar con
"--type secret". Se repitió la operación usando la protección sensible de la
CLI ("--sensitive") y se verificó que el tipo resultante fuera "Secret".

El patrón seguro usado para generar nuevas claves fue equivalente a:

~~~bash
openssl rand -hex 32 | vercel env update APP_SECRET preview --sensitive --yes
openssl rand -hex 32 | vercel env update IPS_TOKEN_KEY preview --sensitive --yes
~~~

La misma corrección se aplicó explícitamente al entorno "production". Los
valores generados no se muestran aquí, no se imprimieron en el documento y no
deben agregarse al repositorio.

### 8.6 Promoción y despliegue de Production

El Preview corregido fue:

~~~text
https://waylo-ai-backend-e10gbctdu.vercel.app
~~~

Su estado quedó "READY" y la inspección reportó Node.js 24 y framework Fastify.
Una promoción inicial produjo un deployment de Production, pero todavía
fallaba con "FUNCTION_INVOCATION_FAILED" porque Production conservaba una
instantánea de variables distinta a Preview.

Después de actualizar las variables de Production, se desplegó de forma
explícita el mismo código corregido:

~~~bash
vercel deploy <temporary-source-dir> \
  --yes \
  --prod \
  --project waylo-ai-backend \
  --scope alexisdurangomez588-gmailcoms-projects
~~~

El deployment resultante quedó "READY" y su alias incluyó el dominio de
producción "waylo-ai-backend-zeta.vercel.app".

La promoción inicial se ejecutó con:

~~~bash
vercel promote https://waylo-ai-backend-e10gbctdu.vercel.app \
  --scope alexisdurangomez588-gmailcoms-projects \
  --yes
~~~

La promoción no sustituyó por sí sola la configuración efectiva de variables
de Production. Por eso se hizo una actualización explícita de Production y se
publicó de nuevo el mismo árbol de código corregido con "vercel deploy --prod".
El deployment final observado fue "dpl_6SspiDJnUaZz34venTeNhMWuVcoy"; el
deployment generado por la promoción inicial fue
"dpl_EUGGFxLYxGVwqVPNDfaK8mbaV1mv". Estos identificadores no contienen
credenciales y se conservan como evidencia operativa.

## 9. Validación final realizada

### 9.1 Validación local

Los siguientes comandos terminaron correctamente:

~~~bash
npm run typecheck
npm run build
npm exec vitest run test/vercel-entrypoint.test.ts test/docs.test.ts
git diff --check
~~~

El conjunto enfocado de Vitest pasó con 2 archivos y 3 tests. La prueba
específica comprobó que el "default export" fuera una función.

La suite completa no se marcó como exitosa: 3 archivos pasaron y 2 fallaron.
Los 9 fallos de autenticación dependían de la conexión al host externo de Neon
"ep-cold-scene-b59h0wvu-pooler.c-7.us-east-2.aws.neon.tech:5432", inaccesible
desde el entorno de ejecución; otros 9 tests de vínculo IPS quedaron omitidos
por depender de esa configuración de base de datos. Esto es una limitación de
la validación de integración, no una evidencia de que el fix de Vercel haya
fallado.

### 9.2 Validación remota con Vercel CLI

Se consultaron las rutas del Preview y del alias de Production mediante
"vercel curl":

~~~bash
vercel curl /health \
  --deployment <deployment-url> \
  --scope alexisdurangomez588-gmailcoms-projects

vercel curl /docs/json \
  --deployment <deployment-url> \
  --scope alexisdurangomez588-gmailcoms-projects
~~~

Resultados observados:

- "/health" respondió "200" con {"status":"ok"}.
- "/docs/json" respondió "200" con el contrato OpenAPI "3.1.0".
- "/" respondió "404" con el formato de error controlado de Waylo.
- Los logs posteriores mostraron respuestas "200" para health y OpenAPI y no
  volvieron a mostrar "Invalid export", "ERR_REQUIRE_ESM" ni
  "FUNCTION_INVOCATION_FAILED" en esas verificaciones.

## 10. Archivos modificados o relevantes

| Archivo | Propósito |
| --- | --- |
| "src/app.ts" | Handler HTTP "default export" para Vercel y reutilización de la app. |
| "test/vercel-entrypoint.test.ts" | Contrato que garantiza que la entrada por defecto sea invocable. |
| "vercel.json" | Framework Fastify y build con generación de Prisma. |
| ".vercelignore" | Exclusión de secretos, dependencias, tests y artefactos locales. |
| "package.json" | Override de "@fastify/static" a "10.1.0". |
| "package-lock.json" | Resolución reproducible de la cadena compatible CommonJS. |
| "docs/vercel-deployment.md" | Guía operativa resumida del despliegue. |
| Este documento | Evidencia detallada de incidentes, comandos y validaciones. |

## 11. Estado final y pendientes operativos

### Resuelto

- Export por defecto no válido para el entrypoint Fastify de Vercel.
- Fallo "ERR_REQUIRE_ESM" al cargar Swagger UI.
- Configuración inválida de "functions" en "vercel.json".
- Variables de entorno con formato inválido para los validadores del backend.
- Variables rotadas y almacenadas como secretos sensibles en Preview y
  Production.
- Validación remota de health, contrato OpenAPI y respuesta controlada de 404.

### Pendiente de asegurar

1. Alinear el repositorio Git conectado en Vercel con el repositorio que el
   equipo considera canónico. Durante esta sesión Vercel apuntaba a
   "Duran24062005/waylo.ai-backend", mientras el checkout local apuntaba a
   "GustavoAdolfoNavarroPacheco/waylo.ai-backend.git".
2. Confirmar desde el dashboard o con el responsable del proyecto que los
   permisos del autor de commits permiten el despliegue automático en el plan
   Hobby.
3. Hacer un nuevo Preview desde el repositorio Git canónico después de alinear
   la integración y comprobar que conserva "vercel.json", el override de
   "@fastify/static" y las variables de entorno correctas.
4. No eliminar el override de "@fastify/static" sin repetir la prueba remota
   sobre Node.js 24.

## 12. Fuentes técnicas

- Vercel CLI: https://vercel.com/docs/cli
- Configuración de proyectos Vercel: https://vercel.com/docs/project-configuration
- Variables de entorno en Vercel: https://vercel.com/docs/environment-variables
- Despliegue de aplicaciones Fastify: https://vercel.com/docs/frameworks/backend/fastify
- Logs de funciones y despliegues: https://vercel.com/docs/observability/runtime-logs

Este documento no contiene tokens, claves, valores de variables de entorno,
cookies ni credenciales. Los comandos con "vercel" deben ejecutarse con una
sesión autenticada y con el proyecto y scope verificados antes de cualquier
mutación.
