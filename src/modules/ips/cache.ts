import { createHmac } from 'node:crypto';
import { CacheKind, Prisma, type PrismaClient } from '@prisma/client';
import { decryptSecret, encryptSecret } from '../../lib/crypto';

const CACHE_KINDS = [CacheKind.PATIENT, CacheKind.APPOINTMENTS, CacheKind.SITES, CacheKind.CLINICAL];

type EncryptedCacheValue = { version: 'v1'; payload: string };

/**
 * The cache key is stable but does not expose the external subject or the IPS
 * patient id in the database. The value is encrypted separately because the
 * cache contains health data, not just operational metadata.
 */
export function scopedCacheKey(tokenKey: string, externalSubject: string, patientId: number, kind: CacheKind): string {
  return createHmac('sha256', tokenKey)
    .update(`ips-cache:v1:${kind}:${externalSubject}:${patientId}`)
    .digest('hex');
}

export async function readIpsCache<T>(input: {
  prisma: PrismaClient;
  tokenKey: string;
  ipsId: string;
  externalSubject: string;
  patientId: number;
  kind: CacheKind;
}): Promise<{ value: T; fetchedAt: Date } | null> {
  const key = scopedCacheKey(input.tokenKey, input.externalSubject, input.patientId, input.kind);
  const row = await input.prisma.cacheEntry.findUnique({
    where: { ipsId_kind_key: { ipsId: input.ipsId, kind: input.kind, key } },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await input.prisma.cacheEntry.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }

  const value = row.value as EncryptedCacheValue;
  if (!value || value.version !== 'v1' || typeof value.payload !== 'string') return null;
  try {
    return { value: JSON.parse(decryptSecret(value.payload, input.tokenKey)) as T, fetchedAt: row.fetchedAt };
  } catch {
    return null;
  }
}

export async function writeIpsCache(input: {
  prisma: PrismaClient;
  tokenKey: string;
  ipsId: string;
  externalSubject: string;
  patientId: number;
  kind: CacheKind;
  value: unknown;
  ttlMs: number;
}): Promise<void> {
  const key = scopedCacheKey(input.tokenKey, input.externalSubject, input.patientId, input.kind);
  const encrypted: EncryptedCacheValue = {
    version: 'v1',
    payload: encryptSecret(JSON.stringify(input.value), input.tokenKey),
  };
  await input.prisma.cacheEntry.upsert({
    where: { ipsId_kind_key: { ipsId: input.ipsId, kind: input.kind, key } },
    create: {
      ipsId: input.ipsId,
      kind: input.kind,
      key,
      value: encrypted as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + input.ttlMs),
    },
    update: {
      value: encrypted as Prisma.InputJsonValue,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + input.ttlMs),
    },
  });
}

export async function clearIpsCache(input: {
  prisma: PrismaClient;
  tokenKey: string;
  ipsId: string;
  externalSubject: string;
  patientId: number;
}): Promise<void> {
  await input.prisma.cacheEntry.deleteMany({
    where: {
      ipsId: input.ipsId,
      key: { in: CACHE_KINDS.map((kind) => scopedCacheKey(input.tokenKey, input.externalSubject, input.patientId, kind)) },
    },
  });
}
