import { describe, expect, it, vi } from 'vitest';
import { CacheKind } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { clearIpsCache, readIpsCache, scopedCacheKey, writeIpsCache } from '../src/modules/ips/cache';
import { encryptSecret } from '../src/lib/crypto';

const tokenKey = 'ab'.repeat(32);

function fakePrisma() {
  const rows = new Map<string, { id: string; value: unknown; fetchedAt: Date; expiresAt: Date }>();
  const cacheEntry = {
    findUnique: vi.fn(async ({ where }: { where: { ipsId_kind_key: { ipsId: string; kind: CacheKind; key: string } } }) => {
      const key = `${where.ipsId_kind_key.ipsId}:${where.ipsId_kind_key.kind}:${where.ipsId_kind_key.key}`;
      return rows.get(key) ?? null;
    }),
    upsert: vi.fn(async ({ where, create, update }: { where: { ipsId_kind_key: { ipsId: string; kind: CacheKind; key: string } }; create: { id?: string; value: unknown; expiresAt: Date; ipsId: string; kind: CacheKind; key: string }; update: { value: unknown; fetchedAt: Date; expiresAt: Date } }) => {
      const key = `${where.ipsId_kind_key.ipsId}:${where.ipsId_kind_key.kind}:${where.ipsId_kind_key.key}`;
      const current = rows.get(key);
      rows.set(key, { id: current?.id ?? create.id ?? `cache-${rows.size + 1}`, value: current ? update.value : create.value, fetchedAt: current ? update.fetchedAt : new Date(), expiresAt: current ? update.expiresAt : create.expiresAt });
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      for (const [key, row] of rows) if (row.id === where.id) rows.delete(key);
    }),
    deleteMany: vi.fn(async () => {
      rows.clear();
    }),
  };
  return { prisma: { cacheEntry } as unknown as PrismaClient, rows, cacheEntry };
}

describe('caché IPS clínica', () => {
  it('uses an opaque scope and encrypts the health value', async () => {
    const { prisma, rows } = fakePrisma();
    await writeIpsCache({ prisma, tokenKey, ipsId: 'ips-1', externalSubject: 'session-1', patientId: 42, kind: CacheKind.CLINICAL, value: { allergy: 'Penicilina' }, ttlMs: 60_000 });

    const stored = [...rows.values()][0];
    expect(scopedCacheKey(tokenKey, 'session-1', 42, CacheKind.CLINICAL)).not.toContain('session-1');
    expect(JSON.stringify(stored.value)).not.toContain('Penicilina');
    await expect(readIpsCache<{ allergy: string }>({ prisma, tokenKey, ipsId: 'ips-1', externalSubject: 'session-1', patientId: 42, kind: CacheKind.CLINICAL })).resolves.toMatchObject({ value: { allergy: 'Penicilina' } });
  });

  it('does not read expired entries and removes them', async () => {
    const { prisma, cacheEntry } = fakePrisma();
    const key = scopedCacheKey(tokenKey, 'session-1', 42, CacheKind.CLINICAL);
    const value = { version: 'v1', payload: encryptSecret(JSON.stringify({ allergy: 'Penicilina' }), tokenKey) };
    (prisma.cacheEntry.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'expired', value, fetchedAt: new Date(0), expiresAt: new Date(0) });

    await expect(readIpsCache({ prisma, tokenKey, ipsId: 'ips-1', externalSubject: 'session-1', patientId: 42, kind: CacheKind.CLINICAL })).resolves.toBeNull();
    expect(cacheEntry.delete).toHaveBeenCalledWith({ where: { id: 'expired' } });
    expect(key).toHaveLength(64);
  });

  it('can clear every scoped cache entry for a patient', async () => {
    const { prisma, cacheEntry } = fakePrisma();
    await clearIpsCache({ prisma, tokenKey, ipsId: 'ips-1', externalSubject: 'session-1', patientId: 42 });
    expect(cacheEntry.deleteMany).toHaveBeenCalledOnce();
  });
});
