// Calls to the local MagicFinder server.
import type {
  ArchidektResponse, CardPrintingsResponse, CardSearchResponse, CartCheckEvent, CartCheckResponse, ParseResponse, PlanChoices, PrintingsResponse, RunEvent, Settings, StatusResponse,
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
  searchCards: (q: string) => call<CardSearchResponse>('GET', `/api/cards/search?${new URLSearchParams({ q })}`),
  cardPrintings: (oracleId: string) => call<CardPrintingsResponse>('GET', `/api/cards/${encodeURIComponent(oracleId)}/printings`),
  startRun: (text: string, choices: PlanChoices) => call<{ runId: string }>('POST', '/api/runs', { text, choices }),
  replan: (runId: string, choices: PlanChoices) => call<{ ok: true }>('POST', `/api/runs/${runId}/plan`, { choices }),
  tryLonger: (runId: string, k: number) => call<{ ok: true }>('POST', `/api/runs/${runId}/try-longer`, { k }),
  printings: (runId: string, lineId: string) => call<PrintingsResponse>('GET', `/api/runs/${runId}/printings/${encodeURIComponent(lineId)}`),
  /** Runs the cart pre-check, reporting each card as it is checked. */
  cart: async (runId: string, storeId: string, k: number, onProgress: (done: number, total: number, name: string) => void): Promise<CartCheckResponse> => {
    const res = await fetch(`/api/runs/${runId}/cart`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId, k }) });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as CartCheckEvent;
        if (e.type === 'progress') onProgress(e.done, e.total, e.name);
        else if (e.type === 'result') return e.result;
        else throw new Error(e.message);
      }
    }
    throw new Error('The cart check stopped before finishing. Try again.');
  },
};

/** Follows a run's live updates. Returns a function that stops listening. */
export function followRun(runId: string, onEvent: (e: RunEvent) => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/events`);
  es.onmessage = m => {
    if (m.data) onEvent(JSON.parse(m.data) as RunEvent);
  };
  return () => es.close();
}
