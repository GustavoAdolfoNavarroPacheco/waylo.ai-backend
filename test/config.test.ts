import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const validEnvironment = {
  DATABASE_URL: 'postgresql://waylo:test@127.0.0.1:5432/waylo_test',
  APP_SECRET: 'test-app-secret-de-al-menos-32-caracteres',
  IPS_TOKEN_KEY: 'ab'.repeat(32),
};

describe('configuración del backend', () => {
  it('applies safe defaults and normalizes empty optional values', () => {
    const config = loadConfig({
      ...validEnvironment,
      WAYLO_INTERNAL_KEY: '',
      RETO_KEY: '',
      CONFIANZA_BASE_URL: '',
      LLM_BASE_URL: '',
      CONFIANZA_ENABLED: 'true',
    });

    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3001,
      SESSION_TTL_DAYS: 30,
      CONFIANZA_BASE_URL: 'http://localhost:8000',
      WAYLO_INTERNAL_KEY: undefined,
      RETO_KEY: undefined,
      CONFIANZA_ENABLED: true,
      RETO_BASE_URL: 'https://api.reto.pltk.mx/v1',
    });
  });

  it('rejects weak application secrets and malformed IPS encryption keys', () => {
    expect(() => loadConfig({ ...validEnvironment, APP_SECRET: 'short' })).toThrow();
    expect(() => loadConfig({ ...validEnvironment, IPS_TOKEN_KEY: 'not-hex' })).toThrow();
    expect(() => loadConfig({ ...validEnvironment, IPS_TOKEN_KEY: 'ab'.repeat(31) })).toThrow();
  });

  it('coerces numeric settings and rejects invalid ports', () => {
    expect(loadConfig({ ...validEnvironment, PORT: '4100', SESSION_TTL_DAYS: '7' })).toMatchObject({
      PORT: 4100,
      SESSION_TTL_DAYS: 7,
    });
    expect(() => loadConfig({ ...validEnvironment, PORT: '0' })).toThrow();
    expect(() => loadConfig({ ...validEnvironment, PORT: 'not-a-port' })).toThrow();
  });
});
