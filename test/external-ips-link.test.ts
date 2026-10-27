import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { testConfig } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('vínculo externo Waylo → Confianza', () => {
  it('intercambia el código y devuelve solo el estado, no el token de la IPS', async () => {
    const created: { accessTokenEncrypted?: string; externalSubject?: string } = {};
    const prisma = {
      ips: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ips-confianza',
          name: 'Confianza IPS',
          slug: 'confianza',
          active: true,
          baseUrl: 'https://confianza.example',
          contractMapping: { adapter: 'confianza', agentKeyEnv: 'CONFIANZA_AGENT_KEY' },
        }),
      },
      externalIpsLink: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: { data: typeof created }) => {
          Object.assign(created, data);
          return { ...data, ips: { name: 'Confianza IPS', slug: 'confianza' } };
        }),
      },
    } as unknown as PrismaClient;

    vi.stubEnv('CONFIANZA_AGENT_KEY', 'agent-key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'secret-ips-token', expires_in: 900, identity: { patient_id: 42 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const app = await buildApp({
      config: testConfig({ WAYLO_INTERNAL_KEY: 'test-internal-key-that-is-long-enough' }),
      prisma,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ips/link',
      headers: { 'x-waylo-internal-key': 'test-internal-key-that-is-long-enough' },
      payload: {
        external_subject: 'waylo-session-1',
        ips_id: 'confianza',
        document_type: 'CC',
        document_number: '1032456789',
        eps: 'Confianza',
        activation_code: '123456',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'active', ips: { slug: 'confianza' } });
    expect(JSON.stringify(response.json())).not.toContain('secret-ips-token');
    expect(created.externalSubject).toBe('waylo-session-1');
    expect(created.accessTokenEncrypted).toMatch(/^v1\./);
    expect(created.accessTokenEncrypted).not.toContain('secret-ips-token');
  });
});
