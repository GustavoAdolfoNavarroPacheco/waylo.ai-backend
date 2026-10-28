import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { errors } from '../../errors';
import {
  APPOINTMENT_TOOLS,
  executeAppointmentTool,
  type PendingAppointmentConfirmation,
} from './appointment-tools';

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
  app.post('/internal/chat/completion', async (req, reply) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], deps.config.WAYLO_INTERNAL_KEY);
    const body = completionSchema.parse(req.body);
    if (!deps.config.RETO_KEY) throw errors.llmUnavailable('El proveedor Reto no está configurado');

    const providerMessages: ProviderMessage[] = [
      { role: 'system', content: body.system },
      ...toProviderMessages(body),
    ];
    let pending: PendingAppointmentConfirmation | undefined;
    let forceNoTools = false;

    for (let step = 0; step < 5; step += 1) {
      const payload = await requestProvider(deps, body, providerMessages, forceNoTools);
      const message = payload?.choices?.[0]?.message;
      if (!message) throw errors.llmUnavailable('El proveedor Reto devolvió una respuesta vacía');

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length === 0) {
        const text = message.content;
        if (typeof text !== 'string' || !text.trim()) {
          throw errors.llmUnavailable('El proveedor Reto devolvió una respuesta vacía');
        }
        return reply.status(200).send({ text, ...(pending ? { pending_appointment: pending } : {}) });
      }

      if (!body.external_subject) throw errors.llmUnavailable('La herramienta de citas requiere una sesión Waylo');
      providerMessages.push({
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : null,
        tool_calls: toolCalls,
      });
      forceNoTools = false;

      for (const toolCall of toolCalls) {
        const result = await executeAppointmentTool({
          name: toolCall.function?.name ?? '',
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
        forceNoTools = forceNoTools || isWriteToolName(toolCall.function?.name ?? '') || Boolean(result.pending);
      }
    }

    throw errors.llmUnavailable('El ciclo de herramientas de citas excedió el límite');
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

async function requestProvider(
  deps: AppDeps,
  body: CompletionInput,
  messages: ProviderMessage[],
  forceNoTools: boolean,
): Promise<{ choices?: Array<{ message?: { content?: unknown; tool_calls?: ProviderToolCall[] } }> }> {
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
              tools: APPOINTMENT_TOOLS,
              tool_choice: forceNoTools ? 'none' : 'auto',
              parallel_tool_calls: false,
            }
          : {}),
      }),
    });
  } catch {
    throw errors.llmUnavailable('El proveedor Reto no responde');
  }

  const payload = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: ProviderToolCall[] } }>;
  } | null;
  if (!response.ok) throw errors.llmUnavailable(`El proveedor Reto respondió ${response.status}`);
  return payload ?? {};
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
