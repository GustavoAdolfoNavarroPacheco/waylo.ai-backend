import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const chatUrl = process.env.S2_CHAT_URL ?? 'http://localhost:3001/internal/chat/completion';
const internalKey = process.env.S2_INTERNAL_KEY;
const externalSubject = process.env.S2_EXTERNAL_SUBJECT;
const model = process.env.S2_MODEL ?? 'grok-4.20-0309-non-reasoning';
const outputPath = resolve(process.env.S2_OUTPUT ?? 'docs/evidence/s2-executions.jsonl');

if (!internalKey || !externalSubject) {
  throw new Error('Define S2_INTERNAL_KEY y S2_EXTERNAL_SUBJECT antes de registrar la evidencia.');
}

const scenarios = [
  'profile-1',
  'catalog-1',
  'earliest-1',
  'appointments-1',
  'profile-2',
  'catalog-2',
  'earliest-2',
  'appointments-2',
  'earliest-3',
  'catalog-3',
];

const messages = {
  profile: 'Consulta mi perfil institucional y responde con los datos que devuelva la IPS.',
  catalog: 'Consulta el catálogo de servicios, médicos y sedes disponibles en la IPS.',
  earliest: 'Busca los primeros cupos disponibles para medicina general. No apartes nada sin mi confirmación.',
  appointments: 'Lista mis citas actuales en la IPS. No inventes ninguna cita.',
};

const runs = [];
for (let index = 0; index < scenarios.length; index += 1) {
  const scenario = scenarios[index];
  const kind = scenario.split('-')[0];
  const startedAt = Date.now();
  let response;
  let body = null;
  let networkError = null;
  try {
    response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-waylo-internal-key': internalKey },
      body: JSON.stringify({
        model,
        temperature: 0,
        system: 'Eres un agente de demostración. Usa las herramientas IPS reales cuando estén disponibles. No inventes datos.',
        external_subject: externalSubject,
        messages: [{ role: 'user', content: messages[kind] }],
      }),
    });
    body = await response.json().catch(() => null);
  } catch (error) {
    networkError = error instanceof Error ? error.message : 'network_error';
  }

  runs.push({
    run: index + 1,
    scenario,
    execution_id: body?.execution_id ?? response?.headers.get('x-waylo-execution-id') ?? null,
    http_status: response?.status ?? null,
    ok: Boolean(response?.ok),
    duration_ms: Date.now() - startedAt,
    error: networkError ?? body?.error?.code ?? null,
  });
}

const auditResponse = await fetch(`${chatUrl.replace(/\/internal\/chat\/completion$/, '')}/internal/chat/executions?limit=50`, {
  headers: { 'x-waylo-internal-key': internalKey },
}).catch(() => null);
const auditBody = await auditResponse?.json().catch(() => null);
const auditById = new Map((auditBody?.executions ?? []).map((entry) => [entry.id, entry]));
const enriched = runs.map((run) => {
  const execution = run.execution_id ? auditById.get(run.execution_id) : null;
  return {
    ...run,
    agent_status: execution?.status ?? null,
    tool_names: execution?.tool_names ?? [],
    tool_count: execution?.tool_count ?? null,
    retry_count: execution?.retry_count ?? null,
    server_duration_ms: execution?.duration_ms ?? null,
    error: run.error ?? execution?.error_code ?? null,
  };
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${enriched.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
console.log(`Registradas ${enriched.length} ejecuciones en ${outputPath}`);
