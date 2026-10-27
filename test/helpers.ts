import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { createPrisma } from '../src/lib/prisma';

// Los tests de integración usan DATABASE_URL: debe apuntar a la BD de PRUEBAS
// (p. ej. postgresql://waylo:CHANGE_ME@127.0.0.1:5434/waylo_test).
export function requireTestDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL: debe apuntar a la BD de pruebas (waylo_test)');
  return url;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = {
    NODE_ENV: 'test',
    PORT: 3001,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://invalid',
    APP_SECRET: 'test-app-secret-de-al-menos-32-caracteres',
    IPS_TOKEN_KEY: 'ab'.repeat(32),
    SESSION_TTL_DAYS: 1,
    CONFIANZA_BASE_URL: 'http://localhost:9',
    CONFIANZA_ENABLED: false,
    XAI_API_KEY: '',
    EMERGENCY_PHONE: '',
    MENTAL_HEALTH_PHONE: '',
  };
  return { ...base, ...overrides };
}

export async function buildTestApp(): Promise<{ app: FastifyInstance; prisma: PrismaClient }> {
  const prisma = createPrisma();
  const app = await buildApp({ config: testConfig(), prisma });
  return { app, prisma };
}
