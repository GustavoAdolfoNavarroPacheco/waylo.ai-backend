import Fastify, { type FastifyInstance } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import type { PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import type { Config } from './config';
import { loadConfig } from './config';
import { AppError } from './errors';
import { createPrisma } from './lib/prisma';
import { registerHealthRoutes } from './modules/health/routes';
import { registerAuthRoutes } from './modules/auth/routes';
import { registerConsentRoutes } from './modules/consent/routes';
import { registerIpsRoutes } from './modules/ips/routes';
import { registerExternalIpsRoutes } from './modules/ips/external';
import { registerMeRoutes } from './modules/me/routes';

export interface AppDeps {
  config: Config;
  prisma: PrismaClient;
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.NODE_ENV !== 'test' });

  await app.register(cookie);
  app.decorateRequest('userId', null);

  // Todos los errores salen con la forma del contrato: { error: { code, message } }
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.join('.') || 'body';
      return reply.status(422).send({ error: { code: 'VALIDATION', message: `${where}: ${first?.message ?? 'inválido'}` } });
    }
    const status = (err as { statusCode?: number } | null)?.statusCode ?? 500;
    if (status === 401) return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sin sesión' } });
    if (status === 404) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
    if (status >= 400 && status < 500) {
      return reply.status(422).send({ error: { code: 'VALIDATION', message: 'Payload inválido' } });
    }
    req.log.error({ err }, 'Error interno');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Error interno' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }),
  );

  // Swagger UI en /docs, sirviendo el contrato OpenAPI canónico tal cual.
  // Su server relativo conserva el origen actual en local, preview y producción.
  const openapi = parse(readFileSync(resolve(__dirname, '../docs/waylo-api.openapi.yaml'), 'utf8'));
  await app.register(swagger, {
    mode: 'static',
    specification: { document: openapi },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: { docExpansion: 'none', deepLinking: true },
  });

  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerConsentRoutes(app, deps);
  registerIpsRoutes(app, deps);
  registerExternalIpsRoutes(app, deps);
  registerMeRoutes(app, deps);

  return app;
}

// Vercel reutiliza este proceso entre invocaciones cuando hay una instancia
// caliente. Construir la app una sola vez evita crear un PrismaClient por
// cada request y mantiene separado el arranque local de `server.ts`.
let vercelAppPromise: Promise<FastifyInstance> | undefined;

function getVercelApp(): Promise<FastifyInstance> {
  vercelAppPromise ??= (async () => {
    const app = await buildApp({ config: loadConfig(), prisma: createPrisma() });
    await app.ready();
    return app;
  })();

  return vercelAppPromise;
}

// Vercel detecta src/app.ts como la entrada Fastify y exige un export por
// defecto invocable. El servidor local sigue usando server.ts y app.listen().
export default async function vercelHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const app = await getVercelApp();
  app.server.emit('request', request, response);
}
