import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AppDeps } from '../../app';
import { AppError, errors } from '../../errors';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import { requireAuth } from '../auth/guard';
import { createIpsClient } from './client';
import { linkState } from './state';

const linkRequestSchema = z.object({
  document_type: z.string().trim().min(2).max(20),
  document_number: z.string().trim().min(3).max(40),
  eps: z.string().trim().min(2).max(120).nullish(), // Confianza lo exige
  activation_code: z.string().regex(/^\d{6}$/, 'El código de activación son 6 dígitos'),
  // Propuesta pendiente de aceptar en el contrato: slug de la IPS (obligatorio si hay >1 activa)
  ips_id: z.string().trim().min(1).max(64).optional(),
});

const includeIps = { ips: { select: { name: true } } } as const;

// Una IPS activa por cuenta (fila única en ips_links); reactivar o cambiar = UPDATE.
export function registerIpsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { prisma, config } = deps;

  app.get('/ips/link', async (req) => {
    const userId = await requireAuth(req, deps);
    const link = await prisma.ipsLink.findUnique({ where: { userId }, include: includeIps });
    return linkState(link);
  });

  app.post('/ips/link', async (req, reply) => {
    const userId = await requireAuth(req, deps);
    const body = linkRequestSchema.parse(req.body);

    const existing = await prisma.ipsLink.findUnique({ where: { userId }, include: includeIps });
    if (existing?.status === 'ACTIVE') throw errors.linkExists();

    const ips = await resolveIps(prisma, body.ips_id);
    const client = createIpsClient(ips, process.env);

    let activation;
    try {
      activation = await client.exchangeActivation({
        documentType: body.document_type,
        documentNumber: body.document_number,
        eps: body.eps ?? null,
        activationCode: body.activation_code,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw errors.ipsUnavailable();
    }

    const now = new Date();
    const data = {
      ipsId: ips.id,
      documentType: body.document_type,
      documentNumber: body.document_number,
      patientId: activation.patientId,
      accessTokenEncrypted: encryptSecret(activation.accessToken, config.IPS_TOKEN_KEY),
      tokenExpiresAt:
        activation.expiresInSeconds != null ? new Date(now.getTime() + activation.expiresInSeconds * 1000) : null,
      status: 'ACTIVE' as const,
      linkedAt: now,
      statusChangedAt: now,
    };
    const link = existing
      ? await prisma.ipsLink.update({ where: { id: existing.id }, data, include: includeIps })
      : await prisma.ipsLink.create({ data: { ...data, userId }, include: includeIps });

    return reply.status(200).send(linkState(link));
  });

  app.delete('/ips/link', async (req, reply) => {
    const userId = await requireAuth(req, deps);
    const link = await prisma.ipsLink.findUnique({ where: { userId }, include: includeIps });
    if (!link) return reply.status(200).send(linkState(null)); // idempotente
    const updated = await prisma.ipsLink.update({
      where: { id: link.id },
      data: { status: 'UNLINKED', statusChangedAt: new Date(), accessTokenEncrypted: null, tokenExpiresAt: null },
      include: includeIps,
    });
    return reply.status(200).send(linkState(updated));
  });
}

async function resolveIps(prisma: PrismaClient, slug?: string) {
  if (slug) {
    const ips = await prisma.ips.findUnique({ where: { slug } });
    if (!ips || !ips.active) throw errors.noActiveLink(`IPS no disponible: ${slug}`);
    return ips;
  }
  const actives = await prisma.ips.findMany({ where: { active: true } });
  if (actives.length === 0) throw errors.noActiveLink('No hay ninguna IPS configurada');
  if (actives.length > 1) throw errors.validation('Hay varias IPS activas: indica ips_id');
  return actives[0];
}
