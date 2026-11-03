import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { listAgentExecutions, recordAgentExecution } from '../src/modules/chat/execution-log';

describe('registro sanitizado de ejecuciones del agente', () => {
  it('guarda metadatos sin persistir el sujeto en claro', async () => {
    const store = { create: vi.fn().mockResolvedValue({}), findMany: vi.fn() };
    const prisma = { agentExecution: store } as unknown as PrismaClient;

    await recordAgentExecution(prisma, { APP_SECRET: 'test-app-secret-de-al-menos-32-caracteres' }, {
      id: 'run-1',
      externalSubject: 'waylo-session-secret',
      model: 'grok-test',
      status: 'succeeded',
      toolNames: ['list_appointment_catalog', 'find_earliest_availability'],
      retryCount: 1,
      durationMs: 123,
    });

    expect(store.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'run-1',
        provider: 'reto',
        model: 'grok-test',
        status: 'succeeded',
        toolNames: ['list_appointment_catalog', 'find_earliest_availability'],
        toolCount: 2,
        retryCount: 1,
      }),
    });
    const data = store.create.mock.calls[0][0].data;
    expect(data.externalSubjectHash).not.toBe('waylo-session-secret');
    expect(data.externalSubjectHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('devuelve solamente los metadatos permitidos para la lectura interna', async () => {
    const store = {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([{
        id: 'run-1',
        model: 'grok-test',
        status: 'failed',
        toolNames: ['list_my_appointments'],
        toolCount: 1,
        retryCount: 2,
        durationMs: 400,
        errorCode: 'LLM_UNAVAILABLE',
        createdAt: new Date('2026-11-03T12:00:00.000Z'),
      }]),
    };
    const prisma = { agentExecution: store } as unknown as PrismaClient;

    await expect(listAgentExecutions(prisma, 10)).resolves.toEqual([{
      id: 'run-1',
      provider: 'reto',
      model: 'grok-test',
      status: 'failed',
      tool_names: ['list_my_appointments'],
      tool_count: 1,
      retry_count: 2,
      duration_ms: 400,
      error_code: 'LLM_UNAVAILABLE',
      created_at: '2026-11-03T12:00:00.000Z',
    }]);
  });
});
