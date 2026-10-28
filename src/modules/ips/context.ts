import type { CanonicalClinicalNote, CanonicalPatient } from './types';

export interface IpsClinicalContext {
  patient: CanonicalPatient;
  clinicalHistory: CanonicalClinicalNote[];
  source: 'live' | 'cache';
  fetchedAt: string;
}
