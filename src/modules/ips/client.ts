import { errors } from '../../errors';
import { ConfianzaIpsClient } from './confianza';
import { MockIpsClient } from './mock';
import type { ContractMapping, IpsClient } from './types';

// Dispatch por contract_mapping.adapter: mitad declarativa (BD) + mitad en código.
type IpsRow = { baseUrl: string; contractMapping: unknown };

export function createIpsClient(ips: IpsRow, env: Record<string, string | undefined> = process.env): IpsClient {
  const mapping = toMapping(ips.contractMapping);
  switch (mapping.adapter) {
    case 'mock':
      return new MockIpsClient();
    case 'confianza': {
      const keyEnv = mapping.agentKeyEnv ?? 'CONFIANZA_AGENT_KEY';
      const agentKey = env[keyEnv]?.trim() || null;
      return new ConfianzaIpsClient({
        baseUrl: ips.baseUrl,
        agentKey,
        mapping,
        maxAttempts: readAttempts(env.CONFIANZA_MAX_ATTEMPTS),
        retryDelayMs: readDelay(env.CONFIANZA_RETRY_DELAY_MS, env.NODE_ENV === 'test' ? 0 : 200),
      });
    }
    default:
      throw errors.internal(`Adaptador de IPS no implementado: ${String(mapping.adapter)}`);
  }
}

function readAttempts(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 3;
}

function readDelay(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : fallback;
}

function toMapping(json: unknown): ContractMapping {
  if (typeof json !== 'object' || json === null || !('adapter' in json)) {
    throw errors.internal('ips.contract_mapping inválido: falta "adapter"');
  }
  return json as ContractMapping;
}
