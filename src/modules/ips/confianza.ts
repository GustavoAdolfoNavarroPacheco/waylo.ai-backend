import { AppError, errors } from '../../errors';
import type {
  ActivationInput,
  ActivationResult,
  CanonicalAppointment,
  CanonicalPatient,
  ContractMapping,
  IpsClient,
} from './types';

// Adaptador Confianza IPS (openapi.json v0.1.0). Contrato mínimo:
// IPS_CONTRATO_MINIMO.md · gaps abiertos: IPS_CONTRATO_FEEDBACK.md
//   - GET /patients/me no expone `sex` ni la sede del paciente (llegan null hasta que lo agreguen)
//   - X-Confianza-Agent-Key es opcional en el contrato

interface ConfianzaOpts {
  baseUrl: string;
  agentKey: string | null;
  mapping: ContractMapping;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const APPOINTMENT_STATUSES = new Set(['requested', 'confirmed', 'cancelled', 'completed', 'no_show']);

function mapErrorResponse(res: Response): AppError {
  if (res.status >= 400 && res.status < 500) return errors.linkInvalid();
  return errors.ipsUnavailable(`La IPS respondió ${res.status}`);
}

export class ConfianzaIpsClient implements IpsClient {
  constructor(
    private readonly opts: ConfianzaOpts,
    private readonly doFetch: FetchLike = fetch,
  ) {}

  private url(path: string): string {
    // Resolve from the origin so a legacy value ending in `/api/v1/` cannot
    // produce `/api/v1/api/v1/...`.
    return new URL(path, this.opts.baseUrl).toString();
  }

  private agentHeaders(): Record<string, string> {
    if (!this.opts.agentKey) return {};
    const headerName = this.opts.mapping.headerName ?? 'X-Confianza-Agent-Key';
    return { [headerName]: this.opts.agentKey };
  }

  private async call(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.doFetch(this.url(path), init);
    } catch {
      throw errors.ipsUnavailable('La IPS no responde (red o caída)');
    }
  }

  async exchangeActivation(input: ActivationInput): Promise<ActivationResult> {
    const res = await this.call('/api/v1/integrations/agent/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.agentHeaders() },
      body: JSON.stringify({
        document_type: input.documentType,
        document_number: input.documentNumber,
        eps: input.eps, // exigido por Confianza
        activation_code: input.activationCode,
      }),
    });
    if (!res.ok) throw mapErrorResponse(res);
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number | null;
      identity?: { patient_id?: number };
    };
    const patientId = json.identity?.patient_id;
    if (!json.access_token || typeof patientId !== 'number') {
      throw errors.internal('Respuesta inesperada de la IPS al activar el contrato');
    }
    return { accessToken: json.access_token, expiresInSeconds: json.expires_in ?? null, patientId };
  }

  async getPatient(accessToken: string, fallbackPatientId: number): Promise<CanonicalPatient> {
    const res = await this.call('/api/v1/patients/me', {
      headers: { authorization: `Bearer ${accessToken}`, ...this.agentHeaders() },
    });
    if (!res.ok) throw mapErrorResponse(res);
    const p = (await res.json()) as {
      id?: number;
      active?: boolean;
      first_name?: string;
      last_name?: string;
      birth_date?: string | null;
      city?: string | null;
      eps?: string | null;
    };
    if (p.active === false) throw errors.linkInvalid('El usuario está desactivado en la IPS');
    return {
      patientId: p.id ?? fallbackPatientId,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      sex: null, // gap del contrato actual → ver IPS_CONTRATO_FEEDBACK.md
      birthDate: p.birth_date ?? null,
      city: p.city ?? null,
      eps: p.eps ?? null,
      primarySite: null, // gap: /patients/me no trae la sede vinculada aún
    };
  }

  async listAppointments(accessToken: string): Promise<CanonicalAppointment[]> {
    const res = await this.call('/api/v1/appointments', {
      headers: { authorization: `Bearer ${accessToken}`, ...this.agentHeaders() },
    });
    if (!res.ok) throw mapErrorResponse(res);
    const rows = (await res.json()) as Array<{
      id: number | string;
      starts_at?: string;
      ends_at?: string | null;
      status?: string;
      reason?: string | null;
      site_id?: number | null;
    }>;
    return rows.map((a) => ({
      id: String(a.id),
      type: null, // el contrato de Confianza no expone el tipo de cita
      startsAt: a.starts_at ?? '',
      endsAt: a.ends_at ?? null,
      status: (a.status && APPOINTMENT_STATUSES.has(a.status) ? a.status : 'requested') as CanonicalAppointment['status'],
      reason: a.reason ?? null,
      doctorName: null,
      site: null, // llega site_id; el nombre de la sede se resuelve en una fase posterior
    }));
  }
}
