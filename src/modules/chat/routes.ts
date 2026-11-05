import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { errors } from '../../errors';
import {
  IPS_TOOLS,
  executeAppointmentTool,
  type PendingAppointmentConfirmation,
} from './appointment-tools';
import {
  createExecutionId,
  listAgentExecutions,
  recordAgentExecution,
  type AgentExecutionStatus,
} from './execution-log';

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(80_000),
});

const imagePartSchema = z.object({
  type: z.literal('file'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  data: z.object({
    type: z.literal('data'),
    data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(1_300_000),
  }),
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([
    z.string().max(80_000),
    z.array(z.union([textPartSchema, imagePartSchema])).min(1).max(6),
  ]),
});

const completionSchema = z.object({
  model: z.string().trim().min(1).max(120),
  temperature: z.number().min(0).max(2),
  system: z.string().max(120_000),
  messages: z.array(messageSchema).min(1).max(12),
  external_subject: z.string().trim().min(1).max(200).optional(),
  pending_appointment_token: z.string().trim().min(1).max(4096).optional(),
});

type CompletionInput = z.infer<typeof completionSchema>;

export function registerChatRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/internal/chat/executions', async (req) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], deps.config.WAYLO_INTERNAL_KEY);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
    return { executions: await listAgentExecutions(deps.prisma, query.limit) };
  });

  app.post('/internal/chat/completion', async (req, reply) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], deps.config.WAYLO_INTERNAL_KEY);
    const body = completionSchema.parse(req.body);
    if (!deps.config.RETO_KEY) throw errors.llmUnavailable('El proveedor Reto no está configurado');

    const executionId = createExecutionId();
    reply.header('x-waylo-execution-id', executionId);
    const startedAt = Date.now();
    const toolNames: string[] = [];
    let retryCount = 0;
    let status: AgentExecutionStatus = 'failed';
    let errorCode: string | undefined;
    const providerMessages: ProviderMessage[] = [
      { role: 'system', content: body.system },
      ...toProviderMessages(body),
    ];
    let pending: PendingAppointmentConfirmation | undefined;
    let forceNoTools = false;

    try {
      for (let step = 0; step < 5; step += 1) {
        const providerResult = await requestProvider(deps, body, providerMessages, forceNoTools);
        retryCount += providerResult.retryCount;
        const message = providerResult.payload?.choices?.[0]?.message;
        if (!message) throw errors.llmUnavailable('El proveedor Reto devolvió una respuesta vacía');

        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        if (toolCalls.length === 0) {
          const text = message.content;
          if (typeof text !== 'string' || !text.trim()) {
            throw errors.llmUnavailable('El proveedor Reto devolvió una respuesta vacía');
          }
          status = 'succeeded';
          return reply.status(200).send({
            text,
            execution_id: executionId,
            ...(pending ? { pending_appointment: pending } : {}),
          });
        }

        if (!body.external_subject) throw errors.llmUnavailable('Las herramientas IPS requieren una sesión Waylo activa');
        providerMessages.push({
          role: 'assistant',
          content: typeof message.content === 'string' ? message.content : null,
          tool_calls: toolCalls,
        });
        forceNoTools = false;

        for (const toolCall of toolCalls) {
          const toolName = toolCall.function?.name ?? '';
          toolNames.push(toolName);
          const result = await executeAppointmentTool({
            name: toolName,
            rawArguments: toolCall.function?.arguments ?? '{}',
            externalSubject: body.external_subject,
            pendingToken: body.pending_appointment_token,
            latestUserMessage: latestUserMessage(body),
            deps,
          });
          if (result.pending) pending = result.pending;
          if (result.clearPending) pending = undefined;
          providerMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result.output),
          });
          forceNoTools = forceNoTools || isWriteToolName(toolName) || Boolean(result.pending);
        }
      }

      throw errors.llmUnavailable('El ciclo de herramientas de citas excedió el límite');
    } catch (error) {
      errorCode = errorCodeFrom(error);
      throw error;
    } finally {
      await recordAgentExecution(deps.prisma, deps.config, {
        id: executionId,
        externalSubject: body.external_subject,
        model: body.model,
        status,
        toolNames,
        retryCount,
        durationMs: Date.now() - startedAt,
        errorCode,
      });
    }
  });
}

type ProviderToolCall = {
  id: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
};

type ProviderMessage =
  | { role: 'system'; content: string }
  | { role: 'user' | 'assistant'; content: unknown; tool_calls?: ProviderToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type ProviderPayload = { choices?: Array<{ message?: { content?: unknown; tool_calls?: ProviderToolCall[] } }> };

type ProviderRequestResult = { payload: ProviderPayload; retryCount: number };

async function requestProvider(
  deps: AppDeps,
  body: CompletionInput,
  messages: ProviderMessage[],
  forceNoTools: boolean,
): Promise<ProviderRequestResult> {
  const maxAttempts = deps.config.RETO_MAX_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${deps.config.RETO_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deps.config.RETO_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: body.model || deps.config.RETO_MODEL,
          temperature: body.temperature,
          messages,
          ...(body.external_subject
            ? {
                tools: IPS_TOOLS,
                tool_choice: forceNoTools ? 'none' : 'auto',
                parallel_tool_calls: false,
              }
            : {}),
        }),
      });
    } catch {
      if (attempt === maxAttempts) throw errors.llmUnavailable('El proveedor Reto no responde');
      await retryDelay(deps.config.RETO_RETRY_DELAY_MS, attempt);
      continue;
    }

    const payload = (await response.json().catch(() => null)) as ProviderPayload | null;
    if (response.ok) return { payload: payload ?? {}, retryCount: attempt - 1 };
    if (!isRetryableProviderStatus(response.status) || attempt === maxAttempts) {
      throw errors.llmUnavailable(`El proveedor Reto respondió ${response.status}`);
    }
    await retryDelay(deps.config.RETO_RETRY_DELAY_MS, attempt);
  }

  throw errors.llmUnavailable('El proveedor Reto no está disponible después de los reintentos');
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function retryDelay(baseMs: number, attempt: number): Promise<void> {
  const delayMs = baseMs * 2 ** (attempt - 1);
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function errorCodeFrom(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return 'INTERNAL';
}

function requireInternalKey(provided: string | string[] | undefined, expected: string | undefined): void {
  if (!expected) throw errors.integrationUnavailable();
  const actual = Array.isArray(provided) ? provided[0] : provided;
  if (!actual) throw errors.unauthorized('Credencial interna inválida');
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    throw errors.unauthorized('Credencial interna inválida');
  }
}

function toProviderMessages(input: CompletionInput): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  return input.messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part) =>
            part.type === 'text'
              ? { type: 'text', text: part.text }
              : { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data.data}` } },
          ),
  }));
}

function latestUserMessage(input: CompletionInput): string {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message.role === 'user') return typeof message.content === 'string' ? message.content : '';
  }
  return '';
}

function isWriteToolName(name: string): boolean {
  return name === 'create_appointment' || name === 'cancel_appointment' || name === 'reschedule_appointment';
}
