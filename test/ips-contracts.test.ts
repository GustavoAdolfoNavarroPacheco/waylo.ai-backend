import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { createIpsClient } from '../src/modules/ips/client';
import { toContractAppointment } from '../src/modules/ips/contract';
import { linkState } from '../src/modules/ips/state';

describe('contratos y dispatch de IPS', () => {
  it('maps a canonical appointment without leaking internal naming', () => {
    expect(
      toContractAppointment({
        id: 'apt-1',
        type: 'priority',
        startsAt: '2026-11-02T14:00:00Z',
        endsAt: null,
        status: 'requested',
        reason: 'Control',
        doctorName: 'Laura Médica',
        site: { name: 'Centro', address: 'Calle 1', city: 'Bogotá' },
      }),
    ).toEqual({
      id: 'apt-1',
      type: 'priority',
      starts_at: '2026-11-02T14:00:00Z',
      ends_at: null,
      status: 'requested',
      reason: 'Control',
      doctor_name: 'Laura Médica',
      site: { name: 'Centro', address: 'Calle 1', city: 'Bogotá' },
    });
  });

  it('maps every persisted link state and keeps an absent link explicit', () => {
    expect(linkState(null)).toEqual({ status: 'none', ips: null, linked_at: null, status_changed_at: null });

    for (const [source, expected] of [
      ['ACTIVE', 'active'],
      ['UNLINKED', 'unlinked'],
      ['DEACTIVATED', 'deactivated'],
    ] as const) {
      expect(
        linkState({
          status: source,
          linkedAt: new Date('2026-10-01T00:00:00Z'),
          statusChangedAt: new Date('2026-10-02T00:00:00Z'),
          ips: { name: 'Confianza IPS' },
        }),
      ).toEqual({
        status: expected,
        ips: { name: 'Confianza IPS' },
        linked_at: '2026-10-01T00:00:00.000Z',
        status_changed_at: '2026-10-02T00:00:00.000Z',
      });
    }
  });

  it('dispatches the configured adapter and rejects malformed mappings', async () => {
    const mockClient = createIpsClient(
      { baseUrl: 'mock://local', contractMapping: { adapter: 'mock' } },
      {},
    );
    await expect(
      mockClient.exchangeActivation({
        documentType: 'CC',
        documentNumber: '123',
        eps: 'Confianza',
        activationCode: '123456',
      }),
    ).resolves.toMatchObject({ patientId: 42 });

    expect(() => createIpsClient({ baseUrl: 'mock://local', contractMapping: {} }, {})).toThrowError(AppError);
    expect(() => createIpsClient({ baseUrl: 'mock://local', contractMapping: { adapter: 'future' } }, {})).toThrow(
      'Adaptador de IPS no implementado',
    );
  });
});
