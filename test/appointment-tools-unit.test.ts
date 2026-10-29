import { describe, expect, it, vi } from 'vitest';
import type { AppDeps } from '../src/app';
import { errors } from '../src/errors';
import { executeAppointmentTool, IPS_TOOLS } from '../src/modules/chat/appointment-tools';

const withActiveIpsClient = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/ips/external', () => ({ withActiveIpsClient }));

const client = {
  getPatient: vi.fn().mockResolvedValue({ patientId: 42, name: 'Ana' }),
  listServices: vi.fn().mockResolvedValue([{ id: 1, name: 'General' }]),
  listDoctors: vi.fn().mockResolvedValue([{ id: 2, name: 'Laura' }]),
  listSites: vi.fn().mockResolvedValue([{ id: 3, name: 'Centro' }]),
  listAvailability: vi.fn().mockResolvedValue([{ startsAt: '2026-11-02T14:00:00Z' }]),
  earliestAvailability: vi.fn().mockResolvedValue([{ startsAt: '2026-11-03T09:00:00Z' }]),
  listAppointments: vi.fn().mockResolvedValue([{ id: 'apt-1', status: 'confirmed' }]),
  createAppointment: vi.fn().mockResolvedValue({ id: 'apt-2', status: 'requested' }),
  cancelAppointment: vi.fn().mockResolvedValue({ id: 'apt-1', status: 'cancelled' }),
  rescheduleAppointment: vi.fn().mockResolvedValue({ id: 'apt-1', status: 'requested' }),
  getClinicalHistory: vi.fn().mockResolvedValue([{ id: 'note-1' }]),
  getConfirmationDocument: vi.fn().mockResolvedValue({ id: 'document-1' }),
};

const deps = {
  config: {
    APP_SECRET: 'test-app-secret-de-al-menos-32-caracteres',
    IPS_TOKEN_KEY: 'ab'.repeat(32),
  },
  prisma: {},
} as AppDeps;

function input(name: string, rawArguments: unknown, extra: Partial<Parameters<typeof executeAppointmentTool>[0]> = {}) {
  return {
    name,
    rawArguments: typeof rawArguments === 'string' ? rawArguments : JSON.stringify(rawArguments),
    externalSubject: 'patient-session-1',
    latestUserMessage: 'Quiero consultar esto',
    deps,
    ...extra,
  };
}

describe('dispatch unitario de herramientas IPS', () => {
  it('publishes the complete patient-scoped tool contract', () => {
    expect(IPS_TOOLS.map((tool) => tool.function.name)).toEqual([
      'get_patient_profile',
      'list_appointment_catalog',
      'find_availability',
      'list_my_appointments',
      'find_earliest_availability',
      'create_appointment',
      'cancel_appointment',
      'reschedule_appointment',
      'get_clinical_history',
      'get_appointment_confirmation_document',
    ]);
  });

  it('rejects unknown tools and malformed arguments before touching the IPS', async () => {
    await expect(executeAppointmentTool(input('unknown', {}))).resolves.toMatchObject({
      output: { ok: false, code: 'UNKNOWN_TOOL' },
    });
    await expect(executeAppointmentTool(input('get_patient_profile', '{'))).resolves.toMatchObject({
      output: { ok: false, code: 'INVALID_ARGUMENTS' },
    });
    expect(withActiveIpsClient).not.toHaveBeenCalled();
  });

  it('dispatches every read-only tool with the patient scope and token', async () => {
    withActiveIpsClient.mockImplementation(async (_prisma, _key, _subject, operation) =>
      operation(client, 'ips-token', 42, 'ips-1'),
    );

    const cases = [
      ['get_patient_profile', {}, client.getPatient],
      ['list_appointment_catalog', {}, client.listServices],
      ['find_availability', { doctor_id: 2, service_id: 1, date: '2026-11-02' }, client.listAvailability],
      ['find_earliest_availability', { service_id: 1, type: 'general' }, client.earliestAvailability],
      ['list_my_appointments', {}, client.listAppointments],
      ['get_clinical_history', {}, client.getClinicalHistory],
      ['get_appointment_confirmation_document', { appointment_id: 'apt-1' }, client.getConfirmationDocument],
    ] as const;

    for (const [name, args, method] of cases) {
      method.mockClear();
      const result = await executeAppointmentTool(input(name, args));
      expect(result.output).toMatchObject({ ok: true, tool: name });
      expect(method).toHaveBeenCalled();
    }

    expect(client.listAvailability).toHaveBeenCalledWith('ips-token', {
      doctorId: 2,
      serviceId: 1,
      date: '2026-11-02',
    });
    expect(client.getClinicalHistory).toHaveBeenCalledWith('ips-token', 42);
    expect(client.getConfirmationDocument).toHaveBeenCalledWith('ips-token', 'apt-1');
  });

  it('requires signed explicit confirmation before writing and accepts equivalent argument order', async () => {
    withActiveIpsClient.mockImplementation(async (_prisma, _key, _subject, operation) =>
      operation(client, 'ips-token', 42, 'ips-1'),
    );
    const appointmentArgs = {
      doctor_id: 2,
      service_id: 1,
      site_id: 3,
      starts_at: '2026-11-02T14:00:00-05:00',
      type: 'general',
      reason: 'Control',
    };

    const pending = await executeAppointmentTool(input('create_appointment', appointmentArgs));
    expect(pending.pending).toMatchObject({ action: 'create_appointment', summary: expect.stringContaining('2026-11-02') });
    expect(pending.output).toMatchObject({ ok: true, status: 'confirmation_required' });
    expect(client.createAppointment).not.toHaveBeenCalled();

    const confirmed = await executeAppointmentTool(
      input(
        'create_appointment',
        {
          reason: 'Control',
          type: 'general',
          starts_at: '2026-11-02T14:00:00-05:00',
          site_id: 3,
          service_id: 1,
          doctor_id: 2,
        },
        { pendingToken: pending.pending!.token, latestUserMessage: 'Sí, confirmo' },
      ),
    );

    expect(confirmed.output).toMatchObject({ ok: true, tool: 'create_appointment' });
    expect(client.createAppointment).toHaveBeenCalledWith('ips-token', {
      doctorId: 2,
      serviceId: 1,
      siteId: 3,
      startsAt: '2026-11-02T14:00:00-05:00',
      type: 'general',
      reason: 'Control',
    });
  });

  it('does not mutate the IPS when confirmation is declined, incomplete, invalid, or expired', async () => {
    withActiveIpsClient.mockImplementation(async (_prisma, _key, _subject, operation) =>
      operation(client, 'ips-token', 42, 'ips-1'),
    );
    const args = { appointment_id: 'apt-1', reason: 'Cambio' };
    const pending = await executeAppointmentTool(input('cancel_appointment', args));

    const declined = await executeAppointmentTool(
      input('cancel_appointment', args, { pendingToken: pending.pending!.token, latestUserMessage: 'No, mejor no' }),
    );
    expect(declined).toMatchObject({ output: { ok: true, status: 'cancelled' }, clearPending: true });

    const unknown = await executeAppointmentTool(
      input('cancel_appointment', args, { pendingToken: pending.pending!.token, latestUserMessage: 'Necesito pensarlo' }),
    );
    expect(unknown).toMatchObject({ output: { ok: true, status: 'confirmation_required' }, pending: { action: 'cancel_appointment' } });

    const invalid = await executeAppointmentTool(
      input('cancel_appointment', { ...args, reason: 'Otro' }, { pendingToken: pending.pending!.token, latestUserMessage: 'Sí' }),
    );
    expect(invalid).toMatchObject({ output: { ok: false, code: 'CONFIRMATION_INVALID' } });
    expect(client.cancelAppointment).not.toHaveBeenCalled();
  });

  it('normalizes adapter failures into a safe IPS error', async () => {
    withActiveIpsClient.mockRejectedValueOnce(errors.ipsUnavailable());

    await expect(executeAppointmentTool(input('list_my_appointments', {}))).resolves.toMatchObject({
      output: { ok: false, code: 'IPS_UNAVAILABLE' },
    });
  });
});
