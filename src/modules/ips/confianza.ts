import { AppError, errors } from '../../errors';
import type {
  ActivationInput,
  ActivationResult,
  CanonicalAppointment,
  CanonicalAvailabilitySlot,
  CanonicalClinicalNote,
  CanonicalConfirmationDocument,
  CanonicalDoctor,
  CanonicalPatient,
  CanonicalService,
  CanonicalSite,
  ContractMapping,
  CreateAppointmentInput,
  EarliestAvailabilityInput,
  IpsClient,
  RescheduleAppointmentInput,
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
const APPOINTMENT_TYPES = new Set(['general', 'priority']);
const EARLIEST_SEARCH_DAYS = 14;

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
    const p = (await res.json()) as PatientResponsePayload;
    if (p.active === false) throw errors.linkInvalid('El usuario está desactivado en la IPS');
    let primarySite = toSite(p.primary_site ?? p.primarySite ?? p.site ?? null);
    const primarySiteId = p.site_id ?? p.primary_site_id ?? primarySite?.id ?? null;
    if (!primarySite && primarySiteId != null) {
      const sites = await this.listSites(accessToken).catch((error) => optionalCatalogFailure<CanonicalSite>(error));
      primarySite = sites.find((site) => site.id === primarySiteId) ?? null;
    }
    return {
      patientId: p.id ?? fallbackPatientId,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      sex: p.sex ?? null,
      birthDate: p.birth_date ?? null,
      city: p.city ?? null,
      eps: p.eps ?? null,
      primarySite,
    };
  }

  async listAppointments(accessToken: string): Promise<CanonicalAppointment[]> {
    const res = await this.call('/api/v1/appointments', {
      headers: { authorization: `Bearer ${accessToken}`, ...this.agentHeaders() },
    });
    if (!res.ok) throw mapErrorResponse(res);
    const rows = (await res.json()) as Array<AppointmentResponsePayload>;
    const needsDoctors = rows.some((appointment) => appointment.doctor_id != null && !appointment.doctor_name);
    const needsSites = rows.some((appointment) => appointment.site_id != null && !appointment.site);
    const [doctors, sites] = await Promise.all([
      needsDoctors ? this.listDoctors(accessToken).catch((error) => optionalCatalogFailure<CanonicalDoctor>(error)) : Promise.resolve([]),
      needsSites ? this.listSites(accessToken).catch((error) => optionalCatalogFailure<CanonicalSite>(error)) : Promise.resolve([]),
    ]);
    const doctorNames = new Map(doctors.map((doctor) => [doctor.id, doctor.name]));
    const siteById = new Map<number, CanonicalSite>(
      sites.flatMap((site) => (site.id == null ? [] : [[site.id, site] as [number, CanonicalSite]])),
    );
    return rows.map((appointment) => mapAppointment(appointment, doctorNames, siteById));
  }

  async listSites(accessToken: string): Promise<CanonicalSite[]> {
    const res = await this.call('/api/v1/sites', { headers: this.authHeaders(accessToken) });
    if (!res.ok) throw mapErrorResponse(res);
    const rows = (await res.json()) as Array<{ id: number; name: string; address: string; city: string }>;
    return rows.map((site) => ({ id: site.id, name: site.name, address: site.address, city: site.city }));
  }

  async listServices(accessToken: string): Promise<CanonicalService[]> {
    const res = await this.call('/api/v1/services', { headers: this.authHeaders(accessToken) });
    if (!res.ok) throw mapErrorResponse(res);
    const rows = (await res.json()) as Array<{ id: number; name: string; description?: string; duration_minutes?: number }>;
    return rows.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description ?? '',
      durationMinutes: service.duration_minutes ?? 30,
    }));
  }

  async listDoctors(accessToken: string): Promise<CanonicalDoctor[]> {
    const res = await this.call('/api/v1/doctors', { headers: this.authHeaders(accessToken) });
    if (!res.ok) throw mapErrorResponse(res);
    const rows = (await res.json()) as Array<{ id: number; first_name: string; last_name: string }>;
    return rows.map((doctor) => ({ id: doctor.id, name: [doctor.first_name, doctor.last_name].filter(Boolean).join(' ') }));
  }

  async listAvailability(
    accessToken: string,
    input: { doctorId: number; serviceId: number; date: string },
  ): Promise<CanonicalAvailabilitySlot[]> {
    const params = new URLSearchParams({
      doctor_id: String(input.doctorId),
      service_id: String(input.serviceId),
      date: input.date,
    });
    const res = await this.call(`/api/v1/availability?${params}`, { headers: this.authHeaders(accessToken) });
    if (!res.ok) throw mapErrorResponse(res);
    const rows = (await res.json()) as Array<{
      starts_at: string;
      ends_at: string;
      doctor_id: number;
      service_id: number;
      site_id?: number | null;
    }>;
    return rows.map((slot) => ({
      startsAt: slot.starts_at,
      endsAt: slot.ends_at,
      doctorId: slot.doctor_id,
      serviceId: slot.service_id,
      siteId: slot.site_id ?? null,
      doctorName: null,
    }));
  }

  /**
   * Confianza v0.1 does not expose /availability/earliest. The adapter composes
   * its existing per-doctor/per-day endpoint for a bounded best-effort search.
   * It never fabricates a site id when the IPS omits it.
   */
  async earliestAvailability(accessToken: string, input: EarliestAvailabilityInput): Promise<CanonicalAvailabilitySlot[]> {
    void input.type; // Confianza v0.1 has no appointment type field.
    const limit = Math.max(1, Math.min(input.limit ?? 3, 20));
    const from = input.from ? new Date(input.from) : new Date();
    if (Number.isNaN(from.getTime())) throw errors.validation('La fecha inicial de disponibilidad no es válida');
    const doctors = await this.listDoctors(accessToken);
    const found: CanonicalAvailabilitySlot[] = [];
    const seen = new Set<string>();

    for (let offset = 0; offset < EARLIEST_SEARCH_DAYS && found.length < limit; offset += 1) {
      const date = new Date(from.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const perDoctor = await Promise.all(
        doctors.map((doctor) => this.listAvailability(accessToken, {
          doctorId: doctor.id,
          serviceId: input.serviceId,
          date,
        })),
      );
      for (const slots of perDoctor) {
        for (const slot of slots) {
          if (input.siteId != null && slot.siteId !== input.siteId) continue;
          if (new Date(slot.startsAt).getTime() < from.getTime()) continue;
          const key = `${slot.doctorId}:${slot.startsAt}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ ...slot, doctorName: doctors.find((doctor) => doctor.id === slot.doctorId)?.name ?? null });
        }
      }
    }
    return found.sort((left, right) => left.startsAt.localeCompare(right.startsAt)).slice(0, limit);
  }

  async createAppointment(accessToken: string, input: CreateAppointmentInput): Promise<CanonicalAppointment> {
    const res = await this.call('/api/v1/appointments', {
      method: 'POST',
      headers: { ...this.authHeaders(accessToken), 'content-type': 'application/json' },
      // Confianza v0.1 does not define `type`; do not invent a provider field.
      body: JSON.stringify({
        doctor_id: input.doctorId,
        service_id: input.serviceId,
        site_id: input.siteId,
        starts_at: input.startsAt,
        reason: input.reason,
      }),
    });
    if (!res.ok) throw mapErrorResponse(res);
    return mapAppointment((await res.json()) as AppointmentResponsePayload);
  }

  async cancelAppointment(accessToken: string, appointmentId: string, reason: string): Promise<CanonicalAppointment> {
    const res = await this.call(`/api/v1/appointments/${encodeURIComponent(appointmentId)}/status`, {
      method: 'POST',
      headers: { ...this.authHeaders(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', reason }),
    });
    if (!res.ok) throw mapErrorResponse(res);
    return mapAppointment((await res.json()) as AppointmentResponsePayload);
  }

  async rescheduleAppointment(accessToken: string, input: RescheduleAppointmentInput): Promise<CanonicalAppointment> {
    const res = await this.call(`/api/v1/appointments/${encodeURIComponent(input.appointmentId)}/reschedule`, {
      method: 'POST',
      headers: { ...this.authHeaders(accessToken), 'content-type': 'application/json' },
      body: JSON.stringify({ starts_at: input.startsAt, reason: input.reason }),
    });
    if (!res.ok) throw mapErrorResponse(res);
    return mapAppointment((await res.json()) as AppointmentResponsePayload);
  }

  async getClinicalHistory(accessToken: string, patientId: number): Promise<CanonicalClinicalNote[]> {
    const res = await this.call(`/api/v1/clinical/patients/${encodeURIComponent(patientId)}`, {
      headers: this.authHeaders(accessToken),
    });
    if (!res.ok) throw mapErrorResponse(res);
    const rows = (await res.json()) as Array<{
      id: number | string;
      encounter_id: number | string;
      version: number;
      note_type: string;
      content: string;
      created_at: string;
    }>;
    return rows.map((note) => ({
      id: String(note.id),
      encounterId: String(note.encounter_id),
      version: note.version,
      noteType: note.note_type,
      content: note.content,
      createdAt: note.created_at,
    }));
  }

  async getConfirmationDocument(accessToken: string, appointmentId: string): Promise<CanonicalConfirmationDocument> {
    const res = await this.call(`/api/v1/documents/appointments/${encodeURIComponent(appointmentId)}/confirmation`, {
      method: 'POST',
      headers: this.authHeaders(accessToken),
    });
    if (!res.ok) throw mapErrorResponse(res);
    const document = (await res.json()) as {
      id: number | string;
      appointment_id?: number | string | null;
      document_type: string;
      title: string;
      content: string;
      created_at: string;
    };
    return {
      id: String(document.id),
      appointmentId: document.appointment_id == null ? appointmentId : String(document.appointment_id),
      documentType: document.document_type,
      title: document.title,
      content: document.content,
      createdAt: document.created_at,
    };
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return { authorization: `Bearer ${accessToken}`, ...this.agentHeaders() };
  }
}

type AppointmentResponsePayload = {
  id: number | string;
  starts_at?: string;
  ends_at?: string | null;
  status?: string;
  reason?: string | null;
  type?: string | null;
  doctor_id?: number | null;
  doctor_name?: string | null;
  site_id?: number | null;
  site?: { name?: string; address?: string; city?: string } | null;
};

type PatientResponsePayload = {
  id?: number;
  active?: boolean;
  first_name?: string;
  last_name?: string;
  birth_date?: string | null;
  city?: string | null;
  eps?: string | null;
  sex?: string | null;
  site_id?: number | null;
  primary_site_id?: number | null;
  primary_site?: unknown;
  primarySite?: unknown;
  site?: unknown;
};

function mapAppointment(
  a: AppointmentResponsePayload,
  doctorNames = new Map<number, string>(),
  sites: ReadonlyMap<number, CanonicalSite> = new Map(),
): CanonicalAppointment {
  const site = toSite(a.site) ?? (a.site_id != null ? sites.get(a.site_id) ?? null : null);
  return {
    id: String(a.id),
    type: a.type && APPOINTMENT_TYPES.has(a.type) ? (a.type as CanonicalAppointment['type']) : null,
    startsAt: a.starts_at ?? '',
    endsAt: a.ends_at ?? null,
    status: (a.status && APPOINTMENT_STATUSES.has(a.status) ? a.status : 'requested') as CanonicalAppointment['status'],
    reason: a.reason ?? null,
    doctorName: a.doctor_name ?? (a.doctor_id != null ? doctorNames.get(a.doctor_id) ?? null : null),
    site,
  };
}

function toSite(value: unknown): CanonicalSite | null {
  if (!value || typeof value !== 'object') return null;
  const site = value as { id?: number | null; name?: string; address?: string; city?: string };
  if (typeof site.name !== 'string' || typeof site.address !== 'string' || typeof site.city !== 'string') return null;
  return { id: site.id ?? null, name: site.name, address: site.address, city: site.city };
}

function optionalCatalogFailure<T>(error: unknown): T[] {
  if (error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403)) throw error;
  return [];
}
