import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import type { Config } from '../src/config';
import { createPrisma } from '../src/lib/prisma';

// Los tests de integración usan DATABASE_URL: debe apuntar a la BD de PRUEBAS
// (p. ej. postgresql://waylo:CHANGE_ME@127.0.0.1:5434/waylo_test).
export function requireTestDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !canUseTestDatabase()) {
    throw new Error(
      'Falta una DATABASE_URL local para pruebas: usa PostgreSQL de test en localhost, 127.0.0.1 o ::1',
    );
  }
  return url;
}

/** Integration tests must never use a shared or remote database by accident. */
export function canUseTestDatabase(): boolean {
  const value = process.env.DATABASE_URL;
  if (!value) return false;
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
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
    RETO_KEY: undefined,
    RETO_BASE_URL: 'https://api.reto.pltk.mx/v1',
    RETO_MODEL: 'grok-4.20-0309-non-reasoning',
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
