// Registro de IPS por defecto: mock activo (dev local) + confianza controlable
// explícitamente con CONFIANZA_ENABLED.
// Uso: npm run seed:ips  (requiere DATABASE_URL)
import { existsSync } from 'node:fs';
import { createPrisma } from '../lib/prisma';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<void> {
  const prisma = createPrisma();
  try {
    const mock = await prisma.ips.upsert({
      where: { slug: 'mock' },
      update: { active: true },
      create: {
        name: 'IPS Mock (desarrollo)',
        slug: 'mock',
        baseUrl: 'mock://local',
        authType: 'HEADER_KEY',
        contractMapping: { adapter: 'mock' },
        serviceIds: [], // N1/N2: se descubren con GET /services (Fase 1)
        ragDir: 'rag/mock',
        active: true,
      },
    });
    const confianza = await prisma.ips.upsert({
      where: { slug: 'confianza' },
      update: {
        active: process.env.CONFIANZA_ENABLED === 'true',
        baseUrl: process.env.CONFIANZA_BASE_URL ?? 'http://localhost:8000',
      },
      create: {
        name: 'Confianza IPS',
        slug: 'confianza',
        baseUrl: process.env.CONFIANZA_BASE_URL ?? 'http://localhost:8000',
        authType: 'HEADER_KEY',
        contractMapping: {
          adapter: 'confianza',
          headerName: 'X-Confianza-Agent-Key',
          agentKeyEnv: 'CONFIANZA_AGENT_KEY',
        },
        serviceIds: [],
        ragDir: 'rag/confianza',
        active: process.env.CONFIANZA_ENABLED === 'true',
      },
    });
    console.log(
      `IPS listas → mock: ${mock.active ? 'activa' : 'inactiva'} · confianza: ${confianza.active ? 'activa' : 'inactiva'}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
