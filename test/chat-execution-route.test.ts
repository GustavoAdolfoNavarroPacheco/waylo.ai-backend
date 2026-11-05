import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { testConfig } from './helpers';

describe('trazabilidad interna del chat', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;
  const store = {
    create: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const internalKey = 'internal-key-with-at-least-32-characters';

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({
        WAYLO_INTERNAL_KEY: internalKey,
        RETO_KEY: 'reto-key',
        RETO_BASE_URL: 'https://gateway.example.test/v1/',
        RETO_RETRY_DELAY_MS: 0,
      }),
      prisma: { agentExecution: store } as unknown as PrismaClient,
    });
  });

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      Response.json({ choices: [{ message: { content: '{"mensaje":"ok","listo":false}' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    store.create.mockClear();
    store.findMany.mockReset().mockResolvedValue([]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it('asigna un id y persiste el resumen de una ejecución', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chat/completion',
      headers: { 'x-waylo-internal-key': internalKey },
      payload: {
        model: 'grok-test',
        temperature: 0,
        system: 'Eres Waylo.',
        messages: [{ role: 'user', content: 'hola' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().execution_id).toEqual(expect.any(String));
    expect(response.headers['x-waylo-execution-id']).toBe(response.json().execution_id);
    expect(store.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'succeeded', toolNames: [], retryCount: 0 }),
    });
  });

  it('protege la lectura de ejecuciones con la clave interna', async () => {
    const denied = await app.inject({ method: 'GET', url: '/internal/chat/executions' });
    expect(denied.statusCode).toBe(401);

    store.findMany.mockResolvedValue([{
      id: 'run-1',
      model: 'grok-test',
      status: 'succeeded',
      toolNames: ['list_my_appointments'],
      toolCount: 1,
      retryCount: 0,
      durationMs: 55,
      errorCode: null,
      createdAt: new Date('2026-11-03T12:00:00.000Z'),
    }]);
    const allowed = await app.inject({
      method: 'GET',
      url: '/internal/chat/executions?limit=10',
      headers: { 'x-waylo-internal-key': internalKey },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().executions[0]).toMatchObject({ id: 'run-1', tool_names: ['list_my_appointments'] });
  });
});
