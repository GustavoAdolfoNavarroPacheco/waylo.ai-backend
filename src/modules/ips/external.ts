import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CacheKind, Prisma, type PrismaClient } from '@prisma/client';
import type { AppDeps } from '../../app';
import { AppError, errors } from '../../errors';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { createIpsClient } from './client';
import { clearIpsCache, readIpsCache, writeIpsCache } from './cache';
import type { IpsClinicalContext } from './context';
import type { ExternalIpsLinkStatus, IpsClient } from './types';

const CLINICAL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const subjectSchema = z.object({
  external_subject: z.string().trim().min(1).max(200),
});

const linkSchema = subjectSchema.extend({
  ips_id: z.string().trim().min(1).max(64).default('confianza'),
  document_type: z.string().trim().min(2).max(20),
  document_number: z.string().trim().min(3).max(40),
  eps: z.string().trim().min(2).max(120),
  activation_code: z.string().regex(/^\d{6}$/, 'El código de activación son 6 dígitos'),
});

const includeIps = { ips: true } as const;
type ExternalLinkWithIps = Prisma.ExternalIpsLinkGetPayload<{ include: typeof includeIps }>;

export function registerExternalIpsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { prisma, config } = deps;

  app.get('/internal/ips/link', async (req) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], config.WAYLO_INTERNAL_KEY);
    const { external_subject } = subjectSchema.parse(req.query);
    const link = await prisma.externalIpsLink.findUnique({ where: { externalSubject: external_subject }, include: includeIps });
    return externalLinkState(link);
  });

  app.post('/internal/ips/link', async (req, reply) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], config.WAYLO_INTERNAL_KEY);
    const body = linkSchema.parse(req.body);
    const existing = await prisma.externalIpsLink.findUnique({
      where: { externalSubject: body.external_subject },
      include: includeIps,
    });
    if (existing?.status === 'ACTIVE' && !isExpired(existing.tokenExpiresAt)) throw errors.linkExists();

    const ips = await resolveIps(prisma, body.ips_id);
    let activation;
    try {
      activation = await createIpsClient(ips, process.env).exchangeActivation({
        documentType: body.document_type,
        documentNumber: body.document_number,
        eps: body.eps,
        activationCode: body.activation_code,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw errors.ipsUnavailable();
    }

    const now = new Date();
    const data = {
      externalSubject: body.external_subject,
      ipsId: ips.id,
      patientId: activation.patientId,
      accessTokenEncrypted: encryptSecret(activation.accessToken, config.IPS_TOKEN_KEY),
      tokenExpiresAt:
        activation.expiresInSeconds != null ? new Date(now.getTime() + activation.expiresInSeconds * 1000) : null,
      status: 'ACTIVE' as const,
      linkedAt: now,
      statusChangedAt: now,
    };
    if (existing) {
      await clearIpsCache({
        prisma,
        tokenKey: config.IPS_TOKEN_KEY,
        ipsId: existing.ipsId,
        externalSubject: body.external_subject,
        patientId: existing.patientId,
      }).catch(() => undefined);
    }
    const link = existing
      ? await prisma.externalIpsLink.update({ where: { id: existing.id }, data, include: includeIps })
      : await prisma.externalIpsLink.create({ data, include: includeIps });

    return reply.status(200).send(externalLinkState(link));
  });

  app.get('/internal/ips/patient', async (req) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], config.WAYLO_INTERNAL_KEY);
    const { external_subject } = subjectSchema.parse(req.query);
    return withActiveIpsClient(prisma, config.IPS_TOKEN_KEY, external_subject, (client, token, patientId) =>
      client.getPatient(token, patientId),
    );
  });

  app.get('/internal/ips/appointments', async (req) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], config.WAYLO_INTERNAL_KEY);
    const { external_subject } = subjectSchema.parse(req.query);
    return withActiveIpsClient(prisma, config.IPS_TOKEN_KEY, external_subject, (client, token) =>
      client.listAppointments(token),
    );
  });

  app.get('/internal/ips/context', async (req) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], config.WAYLO_INTERNAL_KEY);
    const { external_subject } = subjectSchema.parse(req.query);
    return withActiveIpsClient(prisma, config.IPS_TOKEN_KEY, external_subject, async (client, token, patientId, ipsId) => {
      try {
        const [patient, clinicalHistory] = await Promise.all([
          client.getPatient(token, patientId),
          client.getClinicalHistory(token, patientId),
        ]);
        const context: IpsClinicalContext = {
          patient,
          clinicalHistory,
          source: 'live',
          fetchedAt: new Date().toISOString(),
        };
        await writeIpsCache({
          prisma,
          tokenKey: config.IPS_TOKEN_KEY,
          ipsId,
          externalSubject: external_subject,
          patientId,
          kind: CacheKind.CLINICAL,
          value: context,
          ttlMs: CLINICAL_CACHE_TTL_MS,
        });
        return context;
      } catch (error) {
        if (error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403)) throw error;
        const cached = await readIpsCache<IpsClinicalContext>({
          prisma,
          tokenKey: config.IPS_TOKEN_KEY,
          ipsId,
          externalSubject: external_subject,
          patientId,
          kind: CacheKind.CLINICAL,
        });
        if (!cached) throw error;
        return { ...cached.value, source: 'cache' as const, fetchedAt: cached.fetchedAt.toISOString() };
      }
    });
  });

  app.delete('/internal/ips/link', async (req, reply) => {
    requireInternalKey(req.headers['x-waylo-internal-key'], config.WAYLO_INTERNAL_KEY);
    const { external_subject } = subjectSchema.parse(req.query);
    const link = await prisma.externalIpsLink.findUnique({ where: { externalSubject: external_subject }, include: includeIps });
    if (!link) return reply.status(200).send(externalLinkState(null));
    const updated = await prisma.externalIpsLink.update({
      where: { id: link.id },
      data: { status: 'UNLINKED', statusChangedAt: new Date(), accessTokenEncrypted: null, tokenExpiresAt: null },
      include: includeIps,
    });
    await clearIpsCache({
      prisma,
      tokenKey: config.IPS_TOKEN_KEY,
      ipsId: link.ipsId,
      externalSubject: external_subject,
      patientId: link.patientId,
    }).catch(() => undefined);
    return reply.status(200).send(externalLinkState(updated));
  });
}

/**
 * Resolves the patient-scoped IPS client without exposing its token to callers.
 * Chat tools and the legacy read route share this path so auth failures always
 * deactivate the same local link.
 */
export async function withActiveIpsClient<T>(
  prisma: PrismaClient,
  tokenKey: string,
  externalSubject: string,
  operation: (client: IpsClient, accessToken: string, patientId: number, ipsId: string) => Promise<T>,
): Promise<T> {
  const link = await requireActiveLink(prisma, externalSubject);
  try {
    const token = decryptSecret(link.accessTokenEncrypted!, tokenKey);
    return await operation(createIpsClient(link.ips, process.env), token, link.patientId, link.ipsId);
  } catch (err) {
    await markRejectedLink(prisma, link, err, tokenKey, externalSubject);
    throw err;
  }
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

async function resolveIps(prisma: PrismaClient, slug: string) {
  const ips = await prisma.ips.findUnique({ where: { slug } });
  if (!ips || !ips.active) throw errors.noActiveLink(`IPS no disponible: ${slug}`);
  return ips;
}

async function requireActiveLink(prisma: PrismaClient, externalSubject: string) {
  const link = await prisma.externalIpsLink.findUnique({ where: { externalSubject }, include: includeIps });
  if (!link || link.status !== 'ACTIVE' || !link.accessTokenEncrypted || isExpired(link.tokenExpiresAt)) {
    throw errors.noActiveLink('No hay un vínculo IPS activo o el token expiró');
  }
  return link;
}

async function markRejectedLink(
  prisma: PrismaClient,
  link: ExternalLinkWithIps,
  err: unknown,
  tokenKey: string,
  externalSubject: string,
): Promise<void> {
  if (err instanceof AppError && (err.statusCode === 401 || err.statusCode === 403)) {
    await prisma.externalIpsLink
      .update({ where: { id: link.id }, data: { status: 'DEACTIVATED', statusChangedAt: new Date() } })
      .catch(() => undefined);
    await clearIpsCache({
      prisma,
      tokenKey,
      ipsId: link.ipsId,
      externalSubject,
      patientId: link.patientId,
    }).catch(() => undefined);
  }
}

function isExpired(value: Date | null): boolean {
  return value !== null && value.getTime() <= Date.now();
}

function externalLinkState(link: ExternalLinkWithIps | null) {
  if (!link) return { status: 'none' as ExternalIpsLinkStatus, ips: null, linked_at: null, status_changed_at: null };
  const status: ExternalIpsLinkStatus = link.status === 'ACTIVE' && isExpired(link.tokenExpiresAt)
    ? 'expired'
    : (link.status.toLowerCase() as ExternalIpsLinkStatus);
  return {
    status,
    ips: link.ips ? { name: link.ips.name, slug: link.ips.slug } : null,
    linked_at: link.linkedAt.toISOString(),
    status_changed_at: link.statusChangedAt.toISOString(),
  };
}
