// Códigos de error del contrato (docs/waylo-api.openapi.yaml, schema Error).
export type ErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED' // propuesta añadida al contrato (401 genérico autenticación)
  | 'NOT_FOUND' // propuesta añadida al contrato (404 genérico)
  | 'EMAIL_TAKEN'
  | 'LINK_EXISTS'
  | 'LINK_INVALID'
  | 'NO_ACTIVE_LINK'
  | 'NO_LOCATION'
  | 'INTEGRATION_UNAVAILABLE'
  | 'IPS_UNAVAILABLE'
  | 'LLM_UNAVAILABLE'
  | 'VALIDATION'
  | 'INTERNAL';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export const errors = {
  unauthorized: (message = 'Sin sesión') => new AppError(401, 'UNAUTHORIZED', message),
  notFound: (message = 'Recurso no encontrado') => new AppError(404, 'NOT_FOUND', message),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas'),
  emailTaken: () => new AppError(409, 'EMAIL_TAKEN', 'El email ya existe'),
  linkExists: () => new AppError(409, 'LINK_EXISTS', 'Ya existe un vínculo activo: desvincula primero'),
  linkInvalid: (message = 'Código o documento inválidos') => new AppError(401, 'LINK_INVALID', message),
  noActiveLink: (message = 'Sin vínculo activo con ninguna IPS') => new AppError(409, 'NO_ACTIVE_LINK', message),
  integrationUnavailable: (message = 'La integración interna no está configurada') =>
    new AppError(503, 'INTEGRATION_UNAVAILABLE', message),
  llmUnavailable: (message = 'El proveedor de IA no está disponible') =>
    new AppError(503, 'LLM_UNAVAILABLE', message),
  ipsUnavailable: (message = 'La IPS no respondió') => new AppError(503, 'IPS_UNAVAILABLE', message),
  validation: (message: string) => new AppError(422, 'VALIDATION', message),
  internal: (message = 'Error interno') => new AppError(500, 'INTERNAL', message),
};
