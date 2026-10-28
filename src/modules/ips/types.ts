// Modelo canónico de la IPS (contrato mínimo: IPS_CONTRATO_MINIMO.md).
// Los adaptadores traducen su API real a ESTE modelo; el resto del backend
// nunca habla el dialecto de ninguna IPS.

export interface ActivationInput {
  documentType: string;
  documentNumber: string;
  eps: string | null;
  activationCode: string;
}

export interface ActivationResult {
  accessToken: string;
  expiresInSeconds: number | null;
  patientId: number;
}

export interface CanonicalSite {
  id: number | null;
  name: string;
  address: string;
  city: string;
}

export interface CanonicalPatient {
  patientId: number;
  name: string | null;
  sex: string | null; // la IPS lo expone en /patients/me en el contrato mínimo
  birthDate: string | null; // YYYY-MM-DD
  city: string | null;
  eps: string | null;
  primarySite: CanonicalSite | null; // sede vinculada: obligatoria para N1/N2
}

export interface CanonicalAppointment {
  id: string; // id opaco en la IPS
  type: 'general' | 'priority' | null;
  startsAt: string;
  endsAt: string | null;
  status: 'requested' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  reason: string | null;
  doctorName: string | null;
  site: { name: string; address: string; city: string } | null;
}

export type AppointmentType = 'general' | 'priority';

export interface CanonicalService {
  id: number;
  name: string;
  description: string;
  durationMinutes: number;
}

export interface CanonicalDoctor {
  id: number;
  name: string;
}

export interface CanonicalAvailabilitySlot {
  startsAt: string;
  endsAt: string;
  doctorId: number;
  serviceId: number;
  siteId: number | null;
  doctorName: string | null;
}

export interface EarliestAvailabilityInput {
  serviceId: number;
  type: AppointmentType;
  from?: string;
  limit?: number;
  siteId?: number | null;
}

export interface CanonicalClinicalNote {
  id: string;
  encounterId: string;
  version: number;
  noteType: string;
  content: string;
  createdAt: string;
}

export interface CanonicalConfirmationDocument {
  id: string;
  appointmentId: string | null;
  documentType: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface CreateAppointmentInput {
  doctorId: number;
  serviceId: number;
  siteId: number;
  startsAt: string;
  reason: string;
  type: AppointmentType;
}

export interface RescheduleAppointmentInput {
  appointmentId: string;
  startsAt: string;
  reason: string;
}

export interface IpsClient {
  exchangeActivation(input: ActivationInput): Promise<ActivationResult>;
  getPatient(accessToken: string, patientId: number): Promise<CanonicalPatient>;
  listAppointments(accessToken: string): Promise<CanonicalAppointment[]>;
  listSites(accessToken: string): Promise<CanonicalSite[]>;
  listServices(accessToken: string): Promise<CanonicalService[]>;
  listDoctors(accessToken: string): Promise<CanonicalDoctor[]>;
  listAvailability(
    accessToken: string,
    input: { doctorId: number; serviceId: number; date: string },
  ): Promise<CanonicalAvailabilitySlot[]>;
  earliestAvailability(accessToken: string, input: EarliestAvailabilityInput): Promise<CanonicalAvailabilitySlot[]>;
  createAppointment(accessToken: string, input: CreateAppointmentInput): Promise<CanonicalAppointment>;
  cancelAppointment(accessToken: string, appointmentId: string, reason: string): Promise<CanonicalAppointment>;
  rescheduleAppointment(accessToken: string, input: RescheduleAppointmentInput): Promise<CanonicalAppointment>;
  getClinicalHistory(accessToken: string, patientId: number): Promise<CanonicalClinicalNote[]>;
  getConfirmationDocument(accessToken: string, appointmentId: string): Promise<CanonicalConfirmationDocument>;
}

// contract_mapping (JSONB en ips): mitad declarativa del adaptador híbrido.
export interface ContractMapping {
  adapter: string; // 'mock' | 'confianza'
  headerName?: string; // auth HEADER_KEY: nombre del header (si la IPS lo usa)
  agentKeyEnv?: string; // variable de entorno con la key del agente (el secreto NO vive en la BD)
}

export type ExternalIpsLinkStatus = 'none' | 'active' | 'expired' | 'unlinked' | 'deactivated';
