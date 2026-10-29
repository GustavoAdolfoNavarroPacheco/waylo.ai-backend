# Waylo ↔ Confianza: vigencia del token y pruebas de citas

## Contrato de expiración

Waylo no genera ni acorta el JWT que recibe de Confianza IPS. Durante `POST /internal/ips/link`, el adaptador Confianza lee `expires_in` de `POST /api/v1/integrations/agent/token` y guarda:

```text
tokenExpiresAt = fecha_de_vinculo + expires_in segundos
```

El valor recomendado para la demo es:

```text
AGENT_TOKEN_EXPIRE_MINUTES=43200
```

Esa variable vive en `confianza-ips-backend`, no en el frontend ni en Waylo. Equivale a 30 días. `AGENT_ACTIVATION_EXPIRE_SECONDS=300` es distinto: solo controla el código de activación de un solo uso.

Cambiar la variable no modifica un JWT que ya fue emitido ni la fecha guardada en Waylo. Después de desplegar Confianza hay que generar un código nuevo y volver a vincular la cuenta. Waylo marcará el vínculo como vencido cuando llegue `tokenExpiresAt`; una respuesta 401/403 de la IPS también desactiva el vínculo local para evitar reintentos con credenciales rechazadas.

## Flujo de citas

El adaptador Confianza conserva el contrato institucional:

| Acción del agente | Endpoint Confianza | Resultado |
| --- | --- | --- |
| Consultar cupos | `GET /api/v1/availability` | slots reales de agenda futura |
| Apartar | `POST /api/v1/appointments` | crea una solicitud para el paciente del token |
| Actualizar | `POST /api/v1/appointments/{id}/reschedule` | mueve la cita si el nuevo slot está libre |
| Eliminar | `POST /api/v1/appointments/{id}/status` con `cancelled` | cancelación lógica con historial y auditoría |

Waylo exige confirmación explícita antes de las operaciones mutantes. El catálogo actual distingue `general` y `priority`; “urgente” se conserva como orientación de atención y no se inventa como tipo de cita cuando la IPS no lo expone.

## Fixture de pruebas institucional

Al ejecutar el seed de Confianza, los médicos demo tienen agenda activa de lunes a domingo, de 08:00 a 16:00 en `America/Bogota`. El seed agrega solo días faltantes y no elimina citas o datos existentes. Así, el agente puede consultar disponibilidad y probar el ciclo crear → reprogramar → cancelar.

La API key de Confianza, `WAYLO_INTERNAL_KEY`, `IPS_TOKEN_KEY` y cualquier JWT son secretos de servidor; nunca deben llegar al navegador, a este repositorio ni a los logs.
