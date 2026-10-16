// Calls to the local MagicFinder server.
import type {
  ArchidektResponse, CartCheckResponse, ParseResponse, PlanChoices, PrintingsResponse, RunEvent, Settings, StatusResponse,
} from '../shared/api';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  status: () => call<StatusResponse>('GET', '/api/status'),
  settings: () => call<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => call<Settings>('PUT', '/api/settings', patch),
  tryAgain: (source: string) => call<{ ok: true }>('POST', `/api/sources/${source}/try-again`),
  parse: (text: string) => call<ParseResponse>('POST', '/api/parse', { text }),
  archidekt: (url: string) => call<ArchidektResponse>('POST', '/api/archidekt', { url }),
  startRun: (text: string, choices: PlanChoices) => call<{ runId: string }>('POST', '/api/runs', { text, choices }),
  replan: (runId: string, choices: PlanChoices) => call<{ ok: true }>('POST', `/api/runs/${runId}/plan`, { choices }),
  tryLonger: (runId: string, k: number) => call<{ ok: true }>('POST', `/api/runs/${runId}/try-longer`, { k }),
  printings: (runId: string, lineId: string) => call<PrintingsResponse>('GET', `/api/runs/${runId}/printings/${encodeURIComponent(lineId)}`),
  cart: (runId: string, storeId: string, k: number) => call<CartCheckResponse>('POST', `/api/runs/${runId}/cart`, { storeId, k }),
};

/** Follows a run's live updates. Returns a function that stops listening. */
export function followRun(runId: string, onEvent: (e: RunEvent) => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);
  es.onmessage = m => {
    if (m.data) onEvent(JSON.parse(m.data) as RunEvent);
  };
  return () => es.close();
}
