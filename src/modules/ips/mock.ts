import { errors } from '../../errors';
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
  CreateAppointmentInput,
  EarliestAvailabilityInput,
  IpsClient,
  RescheduleAppointmentInput,
} from './types';

// Adaptador mock: sin red, para desarrollo local y tests.
// Acepta el código de activación 123456; cualquier otro → 401 LINK_INVALID.
const MOCK_ACTIVATION_CODE = '123456';

export class MockIpsClient implements IpsClient {
  async exchangeActivation(input: ActivationInput): Promise<ActivationResult> {
    if (input.activationCode !== MOCK_ACTIVATION_CODE) throw errors.linkInvalid();
    return { accessToken: `mock-token:${input.documentNumber}`, expiresInSeconds: 3600, patientId: 42 };
  }

  async getPatient(_accessToken: string, patientId: number): Promise<CanonicalPatient> {
    return {
      patientId,
      name: 'Paciente Demo',
      sex: 'F',
      birthDate: '1990-05-17',
      city: 'Bogotá',
      eps: 'Salud Total',
      primarySite: { id: 1, name: 'Sede Centro', address: 'Calle 10 # 5-20', city: 'Bogotá' },
    };
  }

  async listAppointments(): Promise<CanonicalAppointment[]> {
    return [];
  }

  async listSites(): Promise<CanonicalSite[]> {
    return [{ id: 1, name: 'Sede Centro', address: 'Calle 10 # 5-20', city: 'Bogotá' }];
  }

  async listServices(): Promise<CanonicalService[]> {
    return [
      { id: 1, name: 'Medicina general', description: 'Consulta general', durationMinutes: 30 },
      { id: 2, name: 'Consulta prioritaria', description: 'Atención prioritaria', durationMinutes: 30 },
    ];
  }

  async listDoctors(): Promise<CanonicalDoctor[]> {
    return [{ id: 1, name: 'Laura Médica' }];
  }

  async listAvailability(): Promise<CanonicalAvailabilitySlot[]> {
    return [];
  }

  async earliestAvailability(_accessToken: string, _input: EarliestAvailabilityInput): Promise<CanonicalAvailabilitySlot[]> {
    return [];
  }

  async createAppointment(_accessToken: string, input: CreateAppointmentInput): Promise<CanonicalAppointment> {
    return {
      id: 'mock-appointment',
      type: input.type,
      startsAt: input.startsAt,
      endsAt: null,
      status: 'requested',
      reason: input.reason || null,
      doctorName: 'Laura Médica',
      site: { name: 'Sede Centro', address: 'Calle 10 # 5-20', city: 'Bogotá' },
    };
  }

  async cancelAppointment(_accessToken: string, appointmentId: string, reason: string): Promise<CanonicalAppointment> {
    return {
      id: appointmentId,
      type: null,
      startsAt: '',
      endsAt: null,
      status: 'cancelled',
      reason: reason || null,
      doctorName: null,
      site: null,
    };
  }

  async rescheduleAppointment(_accessToken: string, input: RescheduleAppointmentInput): Promise<CanonicalAppointment> {
    return {
      id: input.appointmentId,
      type: null,
      startsAt: input.startsAt,
      endsAt: null,
      status: 'requested',
      reason: input.reason || null,
      doctorName: null,
      site: null,
    };
  }

  async getClinicalHistory(): Promise<CanonicalClinicalNote[]> {
    return [];
  }

  async getConfirmationDocument(_accessToken: string, appointmentId: string): Promise<CanonicalConfirmationDocument> {
    return {
      id: `mock-confirmation:${appointmentId}`,
      appointmentId,
      documentType: 'appointment_confirmation',
      title: 'Constancia de cita de demostración',
      content: 'Documento de demostración.',
      createdAt: new Date().toISOString(),
    };
  }
}
