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
});
