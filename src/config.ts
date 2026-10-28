import { z } from 'zod';

// Configuración por variables de entorno (.env en dev; variables reales en prod/Docker).
const emptyToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().min(32),
  IPS_TOKEN_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'IPS_TOKEN_KEY debe ser 64 hex (32 bytes)'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CONFIANZA_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default('http://localhost:8000')),
  WAYLO_INTERNAL_KEY: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  CONFIANZA_ENABLED: z.preprocess((value) => value === true || value === 'true', z.boolean()).default(false),
  RETO_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  RETO_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default('https://api.reto.pltk.mx/v1')),
  RETO_MODEL: z.string().default('grok-4.20-0309-non-reasoning'),
  XAI_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  // Configurables por país (MVP Colombia)
  EMERGENCY_PHONE: z.string().default(''),
  MENTAL_HEALTH_PHONE: z.string().default(''),
  VOICE_BUDGET_MONTHLY_USD: z.coerce.number().min(0).optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return envSchema.parse(env);
}
