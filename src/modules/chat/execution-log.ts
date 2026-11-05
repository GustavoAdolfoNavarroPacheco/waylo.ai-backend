import { createHmac, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Config } from '../../config';

export type AgentExecutionStatus = 'succeeded' | 'failed';

export interface AgentExecutionInput {
  id: string;
  externalSubject?: string;
  model: string;
  status: AgentExecutionStatus;
  toolNames: string[];
  retryCount: number;
  durationMs: number;
  errorCode?: string;
}

export interface AgentExecutionSummary {
  id: string;
  provider: 'reto';
  model: string;
  status: AgentExecutionStatus;
  tool_names: string[];
  tool_count: number;
  retry_count: number;
  duration_ms: number;
  error_code: string | null;
  created_at: string;
}

interface AgentExecutionStore {
  create(input: { data: Record<string, unknown> }): Promise<unknown>;
  findMany(input: { take: number; orderBy: { createdAt: 'desc' } }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

export function createExecutionId(): string {
  return randomUUID();
}

/** Persists only operational metadata. A logging outage must not break a patient response. */
export async function recordAgentExecution(
  prisma: PrismaClient,
  config: Pick<Config, 'APP_SECRET'>,
  input: AgentExecutionInput,
): Promise<void> {
  const store = getStore(prisma);
  if (!store) return;

  await store.create({
    data: {
      id: input.id,
      externalSubjectHash: input.externalSubject
        ? createHmac('sha256', config.APP_SECRET).update(input.externalSubject).digest('hex')
        : null,
      provider: 'reto',
      model: input.model,
      status: input.status,
      toolNames: input.toolNames,
      toolCount: input.toolNames.length,
      retryCount: input.retryCount,
      durationMs: input.durationMs,
      errorCode: input.errorCode ?? null,
    },
  }).catch(() => undefined);
}

export async function listAgentExecutions(
  prisma: PrismaClient,
  limit: number,
): Promise<AgentExecutionSummary[]> {
  const store = getStore(prisma);
  if (!store) return [];

  const rows = await store.findMany({ take: limit, orderBy: { createdAt: 'desc' } });
  return rows.map((row) => ({
    id: String(row.id),
    provider: 'reto',
    model: String(row.model),
    status: row.status === 'succeeded' ? 'succeeded' : 'failed',
    tool_names: Array.isArray(row.toolNames) ? row.toolNames.map(String) : [],
    tool_count: Number(row.toolCount ?? 0),
    retry_count: Number(row.retryCount ?? 0),
    duration_ms: Number(row.durationMs ?? 0),
    error_code: row.errorCode == null ? null : String(row.errorCode),
    created_at: new Date(String(row.createdAt)).toISOString(),
  }));
}

function getStore(prisma: PrismaClient): AgentExecutionStore | undefined {
  return (prisma as unknown as { agentExecution?: AgentExecutionStore }).agentExecution;
}
