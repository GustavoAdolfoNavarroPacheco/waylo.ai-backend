import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { testConfig } from './helpers';

describe('comunicación de chat con el proveedor LLM', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    app = await buildApp({
      config: testConfig({
        WAYLO_INTERNAL_KEY: 'internal-key-with-at-least-32-characters',
        RETO_KEY: 'reto-key',
        RETO_BASE_URL: 'https://gateway.example.test/v1/',
      }),
      prisma: {} as PrismaClient,
    });
  });

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it('protege la ruta interna y reenvía el contrato compatible con OpenAI', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"mensaje":"Hola","listo":false}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chat/completion',
      headers: { 'x-waylo-internal-key': 'internal-key-with-at-least-32-characters' },
      payload: {
        model: 'grok-test',
        temperature: 0.4,
        system: 'Eres Waylo.',
        messages: [{ role: 'user', content: 'Me duele la cabeza' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: '{"mensaje":"Hola","listo":false}' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer reto-key' }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'grok-test',
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'Eres Waylo.' },
        { role: 'user', content: 'Me duele la cabeza' },
      ],
    });
  });

  it('rechaza una clave interna ausente o incorrecta sin llamar al proveedor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chat/completion',
      payload: { model: 'grok-test', temperature: 0.4, system: 'x', messages: [{ role: 'user', content: 'x' }] },
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normaliza una caída del proveedor como LLM_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chat/completion',
      headers: { 'x-waylo-internal-key': 'internal-key-with-at-least-32-characters' },
      payload: {
        model: 'grok-test',
        temperature: 0.4,
        system: 'Eres Waylo.',
        messages: [{ role: 'user', content: 'x' }],
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('LLM_UNAVAILABLE');
  });
});
