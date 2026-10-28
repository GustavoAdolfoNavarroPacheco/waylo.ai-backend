import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppDeps } from '../../app';
import { AppError } from '../../errors';
import { withActiveIpsClient } from '../ips/external';

const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type AppointmentToolName =
  | 'list_appointment_catalog'
  | 'find_availability'
  | 'find_earliest_availability'
  | 'list_my_appointments'
  | 'create_appointment'
  | 'cancel_appointment'
  | 'reschedule_appointment';

export interface PendingAppointmentConfirmation {
  token: string;
  action: Extract<AppointmentToolName, 'create_appointment' | 'cancel_appointment' | 'reschedule_appointment'>;
  summary: string;
}

export interface AppointmentToolExecution {
  output: Record<string, unknown>;
  pending?: PendingAppointmentConfirmation;
  clearPending?: boolean;
}

export const APPOINTMENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_appointment_catalog',
      description: 'Consulta servicios, médicos y sedes activas disponibles para solicitar una cita.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_availability',
      description: 'Consulta los horarios libres de un médico y servicio en una fecha YYYY-MM-DD.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['doctor_id', 'service_id', 'date'],
        properties: {
          doctor_id: { type: 'integer', minimum: 1 },
          service_id: { type: 'integer', minimum: 1 },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_appointments',
      description: 'Consulta las citas del paciente vinculado. Nunca inventes una cita.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_earliest_availability',
      description: 'Busca los primeros cupos de un servicio y tipo de cita sin inventar médico, fecha o sede.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['service_id', 'type'],
        properties: {
          service_id: { type: 'integer', minimum: 1 },
          type: { type: 'string', enum: ['general', 'priority'] },
          from: { type: 'string', minLength: 10, maxLength: 64 },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
          site_id: { type: ['integer', 'null'], minimum: 1 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_appointment',
      description:
        'Solicita una cita. El backend siempre exige confirmación explícita del paciente antes de crearla.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['doctor_id', 'service_id', 'site_id', 'starts_at', 'type'],
        properties: {
          doctor_id: { type: 'integer', minimum: 1 },
          service_id: { type: 'integer', minimum: 1 },
          site_id: { type: 'integer', minimum: 1 },
          starts_at: { type: 'string', minLength: 10, maxLength: 64 },
          type: { type: 'string', enum: ['general', 'priority'] },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_appointment',
      description: 'Cancela una cita propia. El backend siempre exige confirmación explícita del paciente.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['appointment_id'],
        properties: {
          appointment_id: { type: 'string', minLength: 1, maxLength: 120 },
          reason: { type: 'string', maxLength: 240 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_appointment',
      description: 'Reprograma una cita propia. El backend siempre exige confirmación explícita del paciente.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['appointment_id', 'starts_at'],
        properties: {
          appointment_id: { type: 'string', minLength: 1, maxLength: 120 },
          starts_at: { type: 'string', minLength: 10, maxLength: 64 },
          reason: { type: 'string', maxLength: 240 },
        },
      },
    },
  },
] as const;

const schemas: Record<AppointmentToolName, z.ZodTypeAny> = {
  list_appointment_catalog: z.object({}).strict(),
  find_availability: z
    .object({
      doctor_id: z.number().int().positive(),
      service_id: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict(),
  find_earliest_availability: z
    .object({
      service_id: z.number().int().positive(),
      type: z.enum(['general', 'priority']),
      from: z.string().trim().min(10).max(64).optional(),
      limit: z.number().int().min(1).max(20).default(3),
      site_id: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  list_my_appointments: z.object({}).strict(),
  create_appointment: z
    .object({
      doctor_id: z.number().int().positive(),
      service_id: z.number().int().positive(),
      site_id: z.number().int().positive(),
      starts_at: z.string().trim().min(10).max(64),
      type: z.enum(['general', 'priority']),
      reason: z.string().trim().max(500).default(''),
    })
    .strict(),
  cancel_appointment: z
    .object({
      appointment_id: z.string().trim().min(1).max(120),
      reason: z.string().trim().max(240).default(''),
    })
    .strict(),
  reschedule_appointment: z
    .object({
      appointment_id: z.string().trim().min(1).max(120),
      starts_at: z.string().trim().min(10).max(64),
      reason: z.string().trim().max(240).default(''),
    })
    .strict(),
};

type WriteToolName = Extract<AppointmentToolName, 'create_appointment' | 'cancel_appointment' | 'reschedule_appointment'>;

export async function executeAppointmentTool(input: {
  name: string;
  rawArguments: string;
  externalSubject: string;
  pendingToken?: string;
  latestUserMessage: string;
  deps: AppDeps;
}): Promise<AppointmentToolExecution> {
  if (!isAppointmentToolName(input.name)) {
    return failure('UNKNOWN_TOOL', 'La herramienta de citas solicitada no existe.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(input.rawArguments || '{}');
  } catch {
    return failure('INVALID_ARGUMENTS', 'Los argumentos de la herramienta no son JSON válido.');
  }
  const parsed = schemas[input.name].safeParse(raw);
  if (!parsed.success) return failure('INVALID_ARGUMENTS', 'Los argumentos de la herramienta no son válidos.');

  if (isWriteTool(input.name)) {
    const gate = await confirmWrite(input.name, parsed.data, input);
    if (gate) return gate;
  }

  try {
    const result = await withActiveIpsClient(
      input.deps.prisma,
      input.deps.config.IPS_TOKEN_KEY,
      input.externalSubject,
      async (client, accessToken) => {
        switch (input.name) {
          case 'list_appointment_catalog':
            return {
              services: await client.listServices(accessToken),
              doctors: await client.listDoctors(accessToken),
              sites: await client.listSites(accessToken),
            };
          case 'find_availability':
            return client.listAvailability(accessToken, {
              doctorId: parsed.data.doctor_id,
              serviceId: parsed.data.service_id,
              date: parsed.data.date,
            });
          case 'find_earliest_availability':
            return client.earliestAvailability(accessToken, {
              serviceId: parsed.data.service_id,
              type: parsed.data.type,
              from: parsed.data.from,
              limit: parsed.data.limit,
              siteId: parsed.data.site_id,
            });
          case 'list_my_appointments':
            return client.listAppointments(accessToken);
          case 'create_appointment':
            return client.createAppointment(accessToken, {
              doctorId: parsed.data.doctor_id,
              serviceId: parsed.data.service_id,
              siteId: parsed.data.site_id,
              startsAt: parsed.data.starts_at,
              type: parsed.data.type,
              reason: parsed.data.reason,
            });
          case 'cancel_appointment':
            return client.cancelAppointment(accessToken, parsed.data.appointment_id, parsed.data.reason);
          case 'reschedule_appointment':
            return client.rescheduleAppointment(accessToken, {
              appointmentId: parsed.data.appointment_id,
              startsAt: parsed.data.starts_at,
              reason: parsed.data.reason,
            });
        }
      },
    );
    return { output: { ok: true, tool: input.name, data: result } };
  } catch (error) {
    if (error instanceof AppError) return failure(error.code, error.message);
    return failure('IPS_UNAVAILABLE', 'La IPS no respondió. No se hizo ningún cambio.');
  }
}

async function confirmWrite(
  name: WriteToolName,
  args: Record<string, unknown>,
  input: Parameters<typeof executeAppointmentTool>[0],
): Promise<AppointmentToolExecution | null> {
  const summary = summaryFor(name, args);
  if (!input.pendingToken) {
    const pending = createPending(input.deps.config.APP_SECRET, input.externalSubject, name, args, summary);
    return {
      output: {
        ok: true,
        status: 'confirmation_required',
        message: 'Presenta el resumen al paciente y pide una confirmación explícita antes de continuar.',
        summary,
      },
      pending,
    };
  }

  const verified = verifyPending(input.deps.config.APP_SECRET, input.pendingToken, input.externalSubject, name, args);
  if (!verified) return failure('CONFIRMATION_INVALID', 'La confirmación de la cita expiró o ya no coincide con la solicitud.');

  const decision = confirmationDecision(input.latestUserMessage);
  if (decision === 'declined') {
    return { output: { ok: true, status: 'cancelled', message: 'No se hizo ningún cambio en la cita.' }, clearPending: true };
  }
  if (decision !== 'confirmed') {
    return {
      output: { ok: true, status: 'confirmation_required', message: 'Falta una confirmación explícita del paciente.', summary },
      pending: { token: input.pendingToken, action: name, summary },
    };
  }
  return null;
}

function createPending(
  secret: string,
  subject: string,
  action: WriteToolName,
  args: Record<string, unknown>,
  summary: string,
): PendingAppointmentConfirmation {
  const payload = Buffer.from(
    JSON.stringify({ subject, action, digest: argsDigest(secret, action, args), exp: Date.now() + CONFIRMATION_TTL_MS }),
  ).toString('base64url');
  const signature = sign(secret, payload);
  return { token: `${payload}.${signature}`, action, summary };
}

function verifyPending(
  secret: string,
  token: string,
  subject: string,
  action: WriteToolName,
  args: Record<string, unknown>,
): boolean {
  const [payload, signature] = token.split('.');
  const expected = payload ? sign(secret, payload) : '';
  const actualBytes = Buffer.from(signature ?? '');
  const expectedBytes = Buffer.from(expected);
  if (!payload || !signature || actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      subject?: string;
      action?: string;
      digest?: string;
      exp?: number;
    };
    return parsed.subject === subject && parsed.action === action && parsed.digest === argsDigest(secret, action, args) && (parsed.exp ?? 0) > Date.now();
  } catch {
    return false;
  }
}

function sign(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function argsDigest(secret: string, action: WriteToolName, args: Record<string, unknown>): string {
  return createHmac('sha256', secret).update(`${action}:${stableJson(args)}`).digest('base64url');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function confirmationDecision(message: string): 'confirmed' | 'declined' | 'unknown' {
  const normalized = message.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (/\b(no|nunca|mejor no|dejalo|cancelar eso)\b/.test(normalized)) return 'declined';
  if (/^(si|confirmo|confirmar|adelante|hazlo|procede|agendala|agendalo|cancelala|cancelalo|reprogramala|reprogramalo)\b/.test(normalized)) return 'confirmed';
  return 'unknown';
}

function summaryFor(name: WriteToolName, args: Record<string, unknown>): string {
  if (name === 'create_appointment') {
    return `Solicitar cita para ${String(args.starts_at)}; médico ${String(args.doctor_id)}, servicio ${String(args.service_id)}, sede ${String(args.site_id)}.`;
  }
  if (name === 'cancel_appointment') return `Cancelar la cita ${String(args.appointment_id)}.`;
  return `Reprogramar la cita ${String(args.appointment_id)} para ${String(args.starts_at)}.`;
}

function failure(code: string, message: string): AppointmentToolExecution {
  return { output: { ok: false, code, message } };
}

function isAppointmentToolName(value: string): value is AppointmentToolName {
  return (APPOINTMENT_TOOLS as readonly { function: { name: string } }[]).some((tool) => tool.function.name === value);
}

function isWriteTool(value: AppointmentToolName): value is WriteToolName {
  return value === 'create_appointment' || value === 'cancel_appointment' || value === 'reschedule_appointment';
}
