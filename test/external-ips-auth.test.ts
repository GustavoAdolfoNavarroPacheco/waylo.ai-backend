import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { testConfig } from './helpers';

describe('API interna del adaptador IPS', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({ WAYLO_INTERNAL_KEY: 'test-internal-key-that-is-long-enough' }),
      prisma: {} as never,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza solicitudes sin la credencial server-side', async () => {
    const response = await app.inject({ method: 'GET', url: '/internal/ips/link?external_subject=user-1' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });
});
