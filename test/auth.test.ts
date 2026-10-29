import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildTestApp, canUseTestDatabase, requireTestDatabase } from './helpers';
import { sha256hex } from '../src/lib/crypto';

const DOMAIN = '@it-auth.test';

describe.skipIf(!canUseTestDatabase())('auth, consent y cuenta', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let seq = 0;
  const email = () => `it-auth-${Date.now()}-${seq++}${DOMAIN}`;

  beforeAll(async () => {
    requireTestDatabase();
    ({ app, prisma } = await buildTestApp());
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  });

  const register = (mail: string, password = 'clave-secreta1') =>
    app.inject({ method: 'POST', url: '/auth/register', payload: { email: mail, password } });

  const sessionCookie = (res: { cookies: Array<{ name: string; value: string }> }) => ({
    waylo_session: res.cookies.find((c) => c.name === 'waylo_session')!.value,
  });

  it('register crea cuenta + cookie httpOnly y /me responde', async () => {
    const mail = email();
    const res = await register(mail);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: mail });

    const cookie = res.cookies.find((c) => c.name === 'waylo_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');

    const me = await app.inject({ method: 'GET', url: '/me', cookies: sessionCookie(res) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email: mail });
    expect(me.json().profile.name).toEqual({ value: null, source: 'local' });
    expect(me.json().consent).toEqual({ granted: false, text_version: null });
    expect(me.json().link.status).toBe('none');
  });

  it('email duplicado → 409 EMAIL_TAKEN', async () => {
    const mail = email();
    await register(mail);
    const res = await register(mail);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('contraseña corta → 422 VALIDATION', async () => {
    const res = await register(email(), 'corta');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('login: correcto crea sesión; incorrecto → 401 INVALID_CREDENTIALS', async () => {
    const mail = email();
    await register(mail);

    const bad = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: mail, password: 'mala12345' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');

    const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: mail, password: 'clave-secreta1' } });
    expect(ok.statusCode).toBe(200);
    expect(sessionCookie(ok).waylo_session).toBeTruthy();
  });

  it('logout → 204 y la cookie deja de valer', async () => {
    const res = await register(email());
    const cookies = sessionCookie(res);

    const out = await app.inject({ method: 'POST', url: '/auth/logout', cookies });
    expect(out.statusCode).toBe(204);

    const me = await app.inject({ method: 'GET', url: '/me', cookies });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe('UNAUTHORIZED');
  });

  it('/me sin sesión → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('consent queda registrado (seudonimizado) y /me lo refleja', async () => {
    const res = await register(email());
    const cookies = sessionCookie(res);

    const consent = await app.inject({ method: 'POST', url: '/consent', cookies, payload: { text_version: 'v1' } });
    expect(consent.statusCode).toBe(201);
    expect(consent.json().text_version).toBe('v1');
    expect(typeof consent.json().granted_at).toBe('string');

    const me = await app.inject({ method: 'GET', url: '/me', cookies });
    expect(me.json().consent).toEqual({ granted: true, text_version: 'v1' });
  });

  it('borrar cuenta: borra lo local, las sesiones mueren y el consent persiste', async () => {
    const mail = email();
    const res = await register(mail);
    const cookies = sessionCookie(res);
    await app.inject({ method: 'POST', url: '/consent', cookies, payload: { text_version: 'v1' } });

    const del = await app.inject({ method: 'DELETE', url: '/auth/account', cookies });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ deleted: true, appointments_left_in_ips: [] });

    expect(await prisma.user.findUnique({ where: { email: mail } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { tokenHash: sha256hex(cookies.waylo_session) } })).toBeNull();
    expect(await prisma.consent.count()).toBeGreaterThan(0); // la prueba de consentimiento sobrevive

    const me = await app.inject({ method: 'GET', url: '/me', cookies });
    expect(me.statusCode).toBe(401);
  });

  it('ruta inexistente → 404 NOT_FOUND con forma de contrato', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
