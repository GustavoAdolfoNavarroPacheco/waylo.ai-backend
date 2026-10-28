# Memoria clínica de Waylo

## Decisión

Waylo usa un modelo híbrido. La IPS es la fuente oficial y de solo lectura para
historia clínica, medicamentos, alergias, antecedentes y citas. Waylo puede
guardar hechos estructurados declarados por el paciente, pero solo después de
una confirmación explícita.

La memoria propia no reemplaza la historia de la IPS. Si hay conflicto, se
presentan los orígenes y prevalece la IPS.

## Persistencia y retención

- `waylo.ai-backend` guarda únicamente el contexto IPS en `cache_entries`.
- El contenido se cifra con AES-256-GCM y la clave de propietario es un HMAC del
  sujeto externo, paciente, IPS y tipo de caché.
- La caché clínica dura siete días como máximo y solo sirve para lecturas.
- Se borra al desvincular la IPS o al detectar `401`, `403` o paciente inactivo.
- Las escrituras de citas requieren la IPS disponible y nunca usan esta caché.

La memoria personal vive en `waylo.ai`, en `memoria_clinica`, asociada a la
cuenta local. Dura hasta que el usuario la edita o elimina. No se guardan
transcripciones, archivos, documentos ni respuestas completas del modelo.

## Flujo de contexto

1. El servidor de `waylo.ai` solicita `/internal/ips/context` al backend usando
   el sujeto de sesión; el navegador nunca recibe tokens IPS.
2. El backend consulta paciente e historia en la IPS y actualiza la caché si la
   respuesta es válida.
3. Si la IPS no responde, el backend devuelve la caché vigente con `source:
   cache`; si no existe, Waylo continúa sin historia institucional.
4. El frontend combina `IPS_OFICIAL` y `WAYLO_CONFIRMADO` antes de enviar el
   contexto al chat.
5. La historia de la IPS prevalece y cada sección conserva su origen y fecha.

## Escritura de memoria personal

El modelo solo puede proponer un hecho estructurado cuando el paciente pide
explícitamente recordarlo. La aplicación muestra una tarjeta de confirmación;
solo el botón de guardar ejecuta `POST /api/memoria-clinica`.

Las categorías iniciales son condición/antecedente, alergia, medicamento,
cirugía, embarazo y otro. Los registros pueden quedar vigentes o resueltos y
se pueden editar o borrar desde Configuración.
