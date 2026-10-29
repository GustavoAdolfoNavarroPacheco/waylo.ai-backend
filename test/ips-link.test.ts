import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildTestApp, canUseTestDatabase, requireTestDatabase } from './helpers';

const DOMAIN = '@it-ips.test';

describe.skipIf(!canUseTestDatabase())('vínculo con la IPS (adaptador mock)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let seq = 0;

  const seedIps = async () => {
    await prisma.ips.upsert({
      where: { slug: 'mock' },
      update: { active: true, contractMapping: { adapter: 'mock' } },
      create: {
        name: 'IPS Mock (desarrollo)',
        slug: 'mock',
        baseUrl: 'mock://local',
        authType: 'HEADER_KEY',
        contractMapping: { adapter: 'mock' },
        serviceIds: [],
        ragDir: 'rag/mock',
        active: true,
      },
    });
    await prisma.ips.upsert({
      where: { slug: 'confianza' },
      update: { active: false },
      create: {
        name: 'Confianza IPS',
        slug: 'confianza',
        baseUrl: 'http://localhost:9',
        authType: 'HEADER_KEY',
        contractMapping: { adapter: 'confianza' },
        serviceIds: [],
        ragDir: 'rag/confianza',
        active: false,
      },
    });
  };

  beforeAll(async () => {
    requireTestDatabase();
    ({ app, prisma } = await buildTestApp());
    await seedIps();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.ips.deleteMany({ where: { slug: { in: ['mock', 'confianza', 'mock2'] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const newUser = async () => {
    const email = `it-ips-${Date.now()}-${seq++}${DOMAIN}`;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'clave-secreta1' },
    });
    const token = res.cookies.find((c) => c.name === 'waylo_session')!.value;
    return { cookies: { waylo_session: token }, email };
  };

  const linkPayload = (extra: Record<string, unknown> = {}) => ({
    document_type: 'CC',
    document_number: '123456789',
    eps: 'Salud Total',
    activation_code: '123456',
    ...extra,
  });

  const postLink = (cookies: Record<string, string>, extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/ips/link', cookies, payload: linkPayload(extra) });

  it('sin vínculo: GET → none; sin sesión → 401', async () => {
    const noSession = await app.inject({ method: 'GET', url: '/ips/link' });
    expect(noSession.statusCode).toBe(401);
    expect(noSession.json().error.code).toBe('UNAUTHORIZED');

    const { cookies } = await newUser();
    const res = await app.inject({ method: 'GET', url: '/ips/link', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'none', ips: null, linked_at: null, status_changed_at: null });
  });

  it('vincular con código válido → active; /me sirve los datos de la IPS', async () => {
    const { cookies, email } = await newUser();
    const res = await postLink(cookies);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'active', ips: { name: 'IPS Mock (desarrollo)' } });
    expect(typeof res.json().linked_at).toBe('string');

    const me = await app.inject({ method: 'GET', url: '/me', cookies });
    const body = me.json();
    expect(body.profile.name).toEqual({ value: 'Paciente Demo', source: 'ips' });
    expect(body.profile.sex).toEqual({ value: 'F', source: 'ips' });
    expect(body.profile.birth_date).toEqual({ value: '1990-05-17', source: 'ips' });
    expect(body.profile.city).toEqual({ value: 'Bogotá', source: 'ips' });
    expect(body.profile.eps).toEqual({ value: 'Salud Total', source: 'ips' });
    expect(body.primary_site).toMatchObject({ id: 1, name: 'Sede Centro', address: 'Calle 10 # 5-20', city: 'Bogotá' });
    expect(body.link).toMatchObject({ status: 'active', ips: { name: 'IPS Mock (desarrollo)' } });

    // El token de la IPS se guarda cifrado, nunca en claro
    const link = await prisma.ipsLink.findFirst({ where: { user: { email } } });
    expect(link?.accessTokenEncrypted).toMatch(/^v1\./);
    expect(link?.accessTokenEncrypted).not.toContain('mock-token');
    expect(link?.patientId).toBe(42);
  });

  it('código inválido → 401 LINK_INVALID', async () => {
    const { cookies } = await newUser();
    const res = await postLink(cookies, { activation_code: '999999' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('LINK_INVALID');
  });

  it('código de activación mal formado → 422 VALIDATION', async () => {
    const { cookies } = await newUser();
    const res = await postLink(cookies, { activation_code: '12345' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('segundo vínculo activo → 409 LINK_EXISTS', async () => {
    const { cookies } = await newUser();
    await postLink(cookies);
    const again = await postLink(cookies);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('LINK_EXISTS');
  });

  it('desvincular → unlinked y /me vuelve a lo local; reactivar reutiliza la fila', async () => {
    const { cookies, email } = await newUser();
    await postLink(cookies);

    const del = await app.inject({ method: 'DELETE', url: '/ips/link', cookies });
    expect(del.statusCode).toBe(200);
    expect(del.json().status).toBe('unlinked');

    const me = await app.inject({ method: 'GET', url: '/me', cookies });
    expect(me.json().profile.name).toEqual({ value: null, source: 'local' });
    expect(me.json().primary_site).toBeNull();
    expect(me.json().link.status).toBe('unlinked');

    const relink = await postLink(cookies);
    expect(relink.statusCode).toBe(200);
    expect(relink.json().status).toBe('active');
    expect(await prisma.ipsLink.count({ where: { user: { email } } })).toBe(1);
  });

  it('DELETE sin vínculo → 200 none (idempotente)', async () => {
    const { cookies } = await newUser();
    const del = await app.inject({ method: 'DELETE', url: '/ips/link', cookies });
    expect(del.statusCode).toBe(200);
    expect(del.json().status).toBe('none');
  });

  it('ips_id a una IPS inactiva → 409 NO_ACTIVE_LINK', async () => {
    const { cookies } = await newUser();
    const res = await postLink(cookies, { ips_id: 'confianza' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_ACTIVE_LINK');
  });

  it('varias IPS activas: sin ips_id → 422; con ips_id → active', async () => {
    await prisma.ips.upsert({
      where: { slug: 'mock2' },
      update: { active: true },
      create: {
        name: 'IPS Mock 2',
        slug: 'mock2',
        baseUrl: 'mock://local',
        authType: 'HEADER_KEY',
        contractMapping: { adapter: 'mock' },
        serviceIds: [],
        ragDir: 'rag/mock2',
        active: true,
      },
    });
    const { cookies } = await newUser();

    const noSlug = await postLink(cookies);
    expect(noSlug.statusCode).toBe(422);
    expect(noSlug.json().error.code).toBe('VALIDATION');

    const withSlug = await postLink(cookies, { ips_id: 'mock2' });
    expect(withSlug.statusCode).toBe(200);
    expect(withSlug.json()).toMatchObject({ status: 'active', ips: { name: 'IPS Mock 2' } });

    await prisma.ips.update({ where: { slug: 'mock2' }, data: { active: false } });
  });
});
