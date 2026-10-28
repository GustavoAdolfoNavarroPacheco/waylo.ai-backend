import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { testConfig } from './helpers';
import { encryptSecret } from '../src/lib/crypto';
import type { PrismaClient } from '@prisma/client';

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

  it('expone una configuración ausente como error de integración y no consulta la base', async () => {
    const unconfiguredApp = await buildApp({ config: testConfig(), prisma: {} as never });

    const response = await unconfiguredApp.inject({
      method: 'GET',
      url: '/internal/ips/link?external_subject=user-1',
    });
    await unconfiguredApp.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('INTEGRATION_UNAVAILABLE');
  });

  it('devuelve contexto clínico normalizado y actualiza la caché cifrada', async () => {
    const cacheEntry = { upsert: vi.fn().mockResolvedValue(undefined), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() };
    const prisma = {
      externalIpsLink: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'link-1',
          externalSubject: 'session-1',
          ipsId: 'ips-1',
          patientId: 42,
          accessTokenEncrypted: encryptSecret('mock-token', testConfig().IPS_TOKEN_KEY),
          tokenExpiresAt: null,
          status: 'ACTIVE',
          linkedAt: new Date(),
          statusChangedAt: new Date(),
          ips: { name: 'Mock IPS', slug: 'mock', baseUrl: 'https://mock.example', contractMapping: { adapter: 'mock' } },
        }),
      },
      cacheEntry,
    } as unknown as PrismaClient;
    const app = await buildApp({ config: testConfig({ WAYLO_INTERNAL_KEY: 'test-internal-key-that-is-long-enough' }), prisma });

    const response = await app.inject({
      method: 'GET',
      url: '/internal/ips/context?external_subject=session-1',
      headers: { 'x-waylo-internal-key': 'test-internal-key-that-is-long-enough' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: 'live', patient: { patientId: 42, primarySite: { id: 1 } }, clinicalHistory: [] });
    expect(cacheEntry.upsert).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.json())).not.toContain('mock-token');
  });
});
