import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { encryptSecret } from '../src/lib/crypto';
import { testConfig } from './helpers';

const INTERNAL_KEY = 'internal-key-with-at-least-32-characters';
const TOKEN_KEY = 'ab'.repeat(32);
const SUBJECT = 'waylo-session-appointment-tools';

describe('tools de citas en el ciclo de chat', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;
  const prisma = {
    externalIpsLink: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'link-1',
        status: 'ACTIVE',
        patientId: 42,
        accessTokenEncrypted: encryptSecret('ips-token', TOKEN_KEY),
        tokenExpiresAt: null,
        ips: {
          baseUrl: 'https://confianza.example',
          contractMapping: { adapter: 'confianza' },
        },
      }),
    },
    externalIpsLink_update: vi.fn(),
  } as unknown as PrismaClient;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({
        APP_SECRET: 'test-app-secret-de-al-menos-32-caracteres',
        IPS_TOKEN_KEY: TOKEN_KEY,
        WAYLO_INTERNAL_KEY: INTERNAL_KEY,
        RETO_KEY: 'reto-key',
        RETO_BASE_URL: 'https://gateway.example.test/v1/',
      }),
      prisma,
    });
  });

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body));
        if (body.messages.some((message: { role: string }) => message.role === 'tool')) {
          return Response.json({ choices: [{ message: { content: '{"mensaje":"Listo.","listo":false}' } }] });
        }
        return Response.json({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'call-create-1',
                type: 'function',
                function: {
                  name: 'create_appointment',
                  arguments: JSON.stringify({ doctor_id: 1, service_id: 1, site_id: 1, starts_at: '2026-11-02T14:00:00-05:00', type: 'general', reason: 'Control' }),
                },
              }],
            },
          }],
        });
      }
      return Response.json({
        id: 7,
        starts_at: '2026-11-02T14:00:00Z',
        ends_at: '2026-11-02T14:30:00Z',
        status: 'requested',
        reason: 'Control',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it('intercepta una escritura y exige confirmación antes de llamar a la IPS', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chat/completion',
      headers: { 'x-waylo-internal-key': INTERNAL_KEY },
      payload: {
        model: 'grok-test',
        temperature: 0.4,
        system: 'Usa las herramientas de citas.',
        external_subject: SUBJECT,
        messages: [{ role: 'user', content: 'Quiero una cita' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().pending_appointment).toMatchObject({ action: 'create_appointment' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/chat/completions');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/appointments'))).toBe(false);
  });

  it('solo ejecuta la cita cuando el paciente confirma el resumen firmado', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/internal/chat/completion',
      headers: { 'x-waylo-internal-key': INTERNAL_KEY },
      payload: {
        model: 'grok-test',
        temperature: 0.4,
        system: 'Usa las herramientas de citas.',
        external_subject: SUBJECT,
        messages: [{ role: 'user', content: 'Quiero una cita' }],
      },
    });
    const token = first.json().pending_appointment.token;

    fetchMock.mockClear();
    const second = await app.inject({
      method: 'POST',
      url: '/internal/chat/completion',
      headers: { 'x-waylo-internal-key': INTERNAL_KEY },
      payload: {
        model: 'grok-test',
        temperature: 0.4,
        system: 'Usa las herramientas de citas.',
        external_subject: SUBJECT,
        pending_appointment_token: token,
        messages: [{ role: 'user', content: 'Sí, confírmala' }],
      },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().pending_appointment).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/appointments'))).toBe(true);
  });
});
