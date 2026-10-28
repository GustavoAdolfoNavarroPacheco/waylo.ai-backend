import { describe, expect, it } from 'vitest';
import { ConfianzaIpsClient } from '../src/modules/ips/confianza';

describe('adaptador Confianza IPS', () => {
  it('resuelve la URL sin duplicar el prefijo /api/v1 y envía el contrato de activación', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ConfianzaIpsClient(
      {
        baseUrl: 'https://confianza.example/api/v1/',
        agentKey: 'agent-key',
        mapping: { adapter: 'confianza', headerName: 'X-Confianza-Agent-Key' },
      },
      async (url, init) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({ access_token: 'ips-token', expires_in: 900, identity: { patient_id: 42 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );

    await expect(
      client.exchangeActivation({
        documentType: 'CC',
        documentNumber: '1032456789',
        eps: 'Confianza',
        activationCode: '123456',
      }),
    ).resolves.toMatchObject({ accessToken: 'ips-token', patientId: 42 });

    expect(calls[0]?.url).toBe('https://confianza.example/api/v1/integrations/agent/token');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({
      'content-type': 'application/json',
      'X-Confianza-Agent-Key': 'agent-key',
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      document_type: 'CC',
      document_number: '1032456789',
      eps: 'Confianza',
      activation_code: '123456',
    });
  });

  it('mapea paciente y citas a partir del token limitado', async () => {
    const paths: string[] = [];
    const client = new ConfianzaIpsClient(
      { baseUrl: 'https://confianza.example', agentKey: null, mapping: { adapter: 'confianza' } },
      async (url) => {
        paths.push(url);
        if (url.endsWith('/patients/me')) {
          return new Response(
            JSON.stringify({ id: 42, active: true, first_name: 'Mariana', last_name: 'Paciente', birth_date: '1990-05-17', city: 'Bogotá', eps: 'Confianza' }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify([{ id: 7, starts_at: '2026-11-02T14:00:00Z', ends_at: '2026-11-02T14:30:00Z', status: 'confirmed', reason: 'Control' }]),
          { status: 200 },
        );
      },
    );

    await expect(client.getPatient('ips-token', 42)).resolves.toMatchObject({
      patientId: 42,
      name: 'Mariana Paciente',
      city: 'Bogotá',
      eps: 'Confianza',
    });
    await expect(client.listAppointments('ips-token')).resolves.toEqual([
      {
        id: '7',
        type: null,
        startsAt: '2026-11-02T14:00:00Z',
        endsAt: '2026-11-02T14:30:00Z',
        status: 'confirmed',
        reason: 'Control',
        doctorName: null,
        site: null,
      },
    ]);
    expect(paths).toEqual([
      'https://confianza.example/api/v1/patients/me',
      'https://confianza.example/api/v1/appointments',
    ]);
  });

  it('mapea catálogo, disponibilidad y operaciones de cita sin cambiar el contrato de la IPS', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ConfianzaIpsClient(
      { baseUrl: 'https://confianza.example', agentKey: 'agent-key', mapping: { adapter: 'confianza' } },
      async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/sites')) return new Response(JSON.stringify([{ id: 1, name: 'Centro', address: 'Calle 1', city: 'Bogotá' }]), { status: 200 });
        if (url.endsWith('/services')) return new Response(JSON.stringify([{ id: 2, name: 'General', description: 'Consulta', duration_minutes: 30 }]), { status: 200 });
        if (url.endsWith('/doctors')) return new Response(JSON.stringify([{ id: 3, first_name: 'Laura', last_name: 'Médica' }]), { status: 200 });
        if (url.includes('/availability?')) return new Response(JSON.stringify([{ starts_at: '2026-11-02T14:00:00Z', ends_at: '2026-11-02T14:30:00Z', doctor_id: 3, service_id: 2 }]), { status: 200 });
        const status = url.endsWith('/status') ? 'cancelled' : 'requested';
        return new Response(JSON.stringify({ id: 7, starts_at: '2026-11-02T14:00:00Z', ends_at: '2026-11-02T14:30:00Z', status, reason: 'Control' }), { status: 200 });
      },
    );

    await expect(client.listSites('ips-token')).resolves.toEqual([{ id: 1, name: 'Centro', address: 'Calle 1', city: 'Bogotá' }]);
    await expect(client.listServices('ips-token')).resolves.toEqual([{ id: 2, name: 'General', description: 'Consulta', durationMinutes: 30 }]);
    await expect(client.listDoctors('ips-token')).resolves.toEqual([{ id: 3, name: 'Laura Médica' }]);
    await expect(client.listAvailability('ips-token', { doctorId: 3, serviceId: 2, date: '2026-11-02' })).resolves.toEqual([
      { startsAt: '2026-11-02T14:00:00Z', endsAt: '2026-11-02T14:30:00Z', doctorId: 3, serviceId: 2, siteId: null, doctorName: null },
    ]);
    await expect(client.createAppointment('ips-token', { doctorId: 3, serviceId: 2, siteId: 1, startsAt: '2026-11-02T14:00:00Z', type: 'general', reason: 'Control' })).resolves.toMatchObject({ id: '7', status: 'requested' });
    await expect(client.cancelAppointment('ips-token', '7', 'Ya no puedo asistir')).resolves.toMatchObject({ id: '7', status: 'cancelled' });
    await expect(client.rescheduleAppointment('ips-token', { appointmentId: '7', startsAt: '2026-11-03T14:00:00Z', reason: 'Cambio' })).resolves.toMatchObject({ id: '7', status: 'requested' });

    expect(calls.map((call) => call.url)).toEqual([
      'https://confianza.example/api/v1/sites',
      'https://confianza.example/api/v1/services',
      'https://confianza.example/api/v1/doctors',
      'https://confianza.example/api/v1/availability?doctor_id=3&service_id=2&date=2026-11-02',
      'https://confianza.example/api/v1/appointments',
      'https://confianza.example/api/v1/appointments/7/status',
      'https://confianza.example/api/v1/appointments/7/reschedule',
    ]);
    expect(JSON.parse(String(calls[4]?.init?.body))).toMatchObject({ doctor_id: 3, service_id: 2, site_id: 1 });
    expect(JSON.parse(String(calls[5]?.init?.body))).toEqual({ status: 'cancelled', reason: 'Ya no puedo asistir' });
    expect(JSON.parse(String(calls[6]?.init?.body))).toEqual({ starts_at: '2026-11-03T14:00:00Z', reason: 'Cambio' });
  });

  it('mapea sede primaria, primeros cupos, historia y comprobante', async () => {
    const paths: string[] = [];
    const client = new ConfianzaIpsClient(
      { baseUrl: 'https://confianza.example', agentKey: null, mapping: { adapter: 'confianza' } },
      async (url) => {
        paths.push(url);
        if (url.endsWith('/patients/me')) {
          return Response.json({ id: 42, active: true, first_name: 'Mariana', last_name: 'Paciente', sex: 'female', site_id: 1 });
        }
        if (url.endsWith('/sites')) return Response.json([{ id: 1, name: 'Centro', address: 'Calle 1', city: 'Bogotá' }]);
        if (url.endsWith('/doctors')) return Response.json([{ id: 3, first_name: 'Laura', last_name: 'Médica' }]);
        if (url.includes('/availability?')) {
          return Response.json([{ starts_at: '2026-11-02T14:00:00Z', ends_at: '2026-11-02T14:30:00Z', doctor_id: 3, service_id: 2 }]);
        }
        if (url.endsWith('/clinical/patients/42')) {
          return Response.json([{ id: 11, encounter_id: 9, version: 1, note_type: 'assessment', content: 'Nota clínica', created_at: '2026-10-27T15:00:00Z' }]);
        }
        return Response.json({ id: 12, appointment_id: 7, document_type: 'appointment_confirmation', title: 'Confirmación', content: 'Contenido', created_at: '2026-10-27T15:01:00Z' });
      },
    );

    await expect(client.getPatient('ips-token', 42)).resolves.toMatchObject({
      patientId: 42,
      sex: 'female',
      primarySite: { id: 1, name: 'Centro' },
    });
    await expect(client.earliestAvailability('ips-token', { serviceId: 2, type: 'general', from: '2026-11-02T00:00:00-05:00', limit: 1 })).resolves.toEqual([
      {
        startsAt: '2026-11-02T14:00:00Z',
        endsAt: '2026-11-02T14:30:00Z',
        doctorId: 3,
        serviceId: 2,
        siteId: null,
        doctorName: 'Laura Médica',
      },
    ]);
    await expect(client.getClinicalHistory('ips-token', 42)).resolves.toEqual([
      { id: '11', encounterId: '9', version: 1, noteType: 'assessment', content: 'Nota clínica', createdAt: '2026-10-27T15:00:00Z' },
    ]);
    await expect(client.getConfirmationDocument('ips-token', '7')).resolves.toEqual({
      id: '12',
      appointmentId: '7',
      documentType: 'appointment_confirmation',
      title: 'Confirmación',
      content: 'Contenido',
      createdAt: '2026-10-27T15:01:00Z',
    });
    expect(paths).toEqual([
      'https://confianza.example/api/v1/patients/me',
      'https://confianza.example/api/v1/sites',
      'https://confianza.example/api/v1/doctors',
      'https://confianza.example/api/v1/availability?doctor_id=3&service_id=2&date=2026-11-02',
      'https://confianza.example/api/v1/clinical/patients/42',
      'https://confianza.example/api/v1/documents/appointments/7/confirmation',
    ]);
  });
});
