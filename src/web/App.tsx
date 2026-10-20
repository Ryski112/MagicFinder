import { useCallback, useEffect, useRef, useState } from 'react';
import type { LadderView, ParseResponse, PlanChoices, SearchProgressView, Settings, StatusResponse } from '../shared/api';
import { api, connection, followRun } from './api';
import { PlanStep } from './components/PlanStep';
import { SearchStep } from './components/SearchStep';
import { CITIES, SettingsDrawer } from './components/SettingsDrawer';
import { Button, cx, Dialog, Notice, Switch } from './components/ui';
import { isLineIncluded, WantListStep } from './components/WantListStep';

type Step = 'list' | 'search' | 'plan';
const STEPS: [Step, string][] = [['list', 'Want List'], ['search', 'Search'], ['plan', 'Choose a Plan']];
const DRAFT_KEY = 'magicfinder:draft';
/** Hosted mode: this browser's settings, and whether the first-visit questions have been answered. */
const SETTINGS_KEY = 'magicfinder:settings';
const ASKED_KEY = 'magicfinder:asked';

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; settings then last until the page closes.
  }
}

function storedSettings(): unknown {
  try {
    return JSON.parse(stored(SETTINGS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [text, setText] = useState(loadDraft);
  const [deckName, setDeckName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [choices, setChoices] = useState<PlanChoices>({ included: {}, locks: {} });
  const [step, setStep] = useState<Step>('list');
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<SearchProgressView | null>(null);
  const [queuedAhead, setQueuedAhead] = useState<number | null>(null);
  const [ladder, setLadder] = useState<LadderView | null>(null);
  const [selectedK, setSelectedK] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askFirst, setAskFirst] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const stopFollowing = useRef<(() => void) | null>(null);
  const hosted = !!status?.hosted;

  // Status: wait for the card catalogue on first run.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let settingsAsked = false;
    const poll = () =>
      api.status().then(
        s => {
          setStatus(s);
          // Hosted mode keeps each friend's settings in their browser; the desktop keeps them in settings.json.
          if (!settingsAsked) {
            settingsAsked = true;
            (s.hosted ? api.friendSettings(storedSettings()) : api.settings()).then(setSettings, e => setError((e as Error).message));
          }
          // Quickly while the card list downloads; then now and then, so an update notice found after start-up shows.
          timer = setTimeout(poll, s.catalogue.ready ? 5 * 60 * 1000 : 1500);
        },
        () => (timer = setTimeout(poll, 3000)),
      );
    poll();
    return () => clearTimeout(timer);
  }, []);

  const dark = settings ? settings.theme === 'dark' : true;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // Read the list as it's typed.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {
      // Private windows may refuse storage; the draft just isn't remembered.
    }
    if (!status?.catalogue.ready) return;
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const t = setTimeout(() => api.parse(text).then(setParsed, e => setError((e as Error).message)), 350);
    return () => clearTimeout(t);
  }, [text, status?.catalogue.ready]);

  // Hosted mode re-plans only this browser's run, with the settings and choices current when the batch is sent.
  const latest = useRef({ hosted, settings, runId, choices });
  latest.current = { hosted, settings, runId, choices };

  // Saves are batched briefly so typing a number doesn't re-plan on every keystroke.
  const pendingPatch = useRef<Partial<Settings>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(s => {
      if (!s) return s;
      const next = { ...s, ...patch };
      if (latest.current.hosted) store(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
    if (latest.current.hosted) {
      // The theme doesn't change any Plan.
      if (Object.keys(patch).every(k => k === 'theme')) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const { runId: id, choices: c, settings: s } = latest.current;
        if (id && s) api.replan(id, c, s).catch(e => setError((e as Error).message));
      }, 400);
      return;
    }
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const p = pendingPatch.current;
      pendingPatch.current = {};
      api.saveSettings(p).then(setSettings, e => setError((e as Error).message));
    }, 400);
  }, []);

  const changeChoices = (c: PlanChoices) => {
    setChoices(c);
    if (runId && step === 'plan') api.replan(runId, c, hosted && settings ? settings : undefined).catch(e => setError((e as Error).message));
  };

  /** Follows a run's events. Hosted mode also notices when the run was replaced or dropped, or the connection lost. */
  const follow = (id: string) => {
    stopFollowing.current?.();
    let stop: () => void = () => {};
    const current = () => stopFollowing.current === stopHere;
    const stopHere = () => stop();
    const lost = (message: string) => {
      stop();
      stopFollowing.current = null;
      setRunId(null);
      setLadder(null);
      setStep('list');
      setError(message);
    };
    let checking = false;
    // The stream failed: ask whether the run still exists. No answer at all shows the lost-connection banner.
    const check = async (closed: boolean) => {
      if (checking || !current()) return;
      checking = true;
      try {
        const alive = await api.run(id);
        if (!current()) return;
        if (!alive) lost('This search expired — search again.');
        else if (closed) setTimeout(() => current() && follow(id), 3000);
      } catch {
        // connection.onLost has already put up the banner.
      } finally {
        checking = false;
      }
    };
    stop = followRun(
      id,
      e => {
        if (e.type === 'progress') {
          setQueuedAhead(null);
          setProgress(e.progress);
        } else if (e.type === 'ladder') {
          setLadder(e.ladder);
          setStep(s => (s === 'search' ? 'plan' : s));
        } else if (e.type === 'queued') setQueuedAhead(e.ahead);
        else if (e.type === 'replaced') lost('Replaced by a newer search in another tab.');
        else setError(e.message);
      },
      hosted ? check : undefined,
    );
    stopFollowing.current = stopHere;
  };

  const find = async (chosen: Settings | null = settings) => {
    // Hosted mode asks a new friend where they are before their first search.
    if (hosted && !stored(ASKED_KEY) && !askFirst) {
      setAskFirst(true);
      return;
    }
    setError(null);
    setProgress(null);
    setQueuedAhead(null);
    setLadder(null);
    setSelectedK(null);
    stopFollowing.current?.();
    try {
      const { runId: id } = await api.startRun(text, choices, hosted && chosen ? chosen : undefined);
      setRunId(id);
      setStep('search');
      follow(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Hosted mode: a call that gets no answer means the NAS is unreachable or the Access session expired.
  useEffect(() => {
    if (!hosted) return;
    connection.onLost = () => {
      setConnectionLost(true);
      stopFollowing.current?.();
      stopFollowing.current = null;
    };
    return () => {
      connection.onLost = null;
    };
  }, [hosted]);

  // Hosted mode: after a reload, pick up this browser's search if it is still alive, on its progress or Plan.
  const reconnectTried = useRef(false);
  useEffect(() => {
    if (!hosted || !settings || reconnectTried.current) return;
    reconnectTried.current = true;
    api.browserRun().then(
      r => {
        if (!r || latest.current.runId) return;
        setChoices(r.choices);
        setRunId(r.runId);
        setStep('search');
        follow(r.runId);
      },
      () => {},
    );
  }, [hosted, settings]);
  useEffect(() => () => stopFollowing.current?.(), []);

  const importDeck = async (url: string) => {
    const r = await api.archidekt(url);
    setText(r.text);
    setDeckName(r.deckName);
    setChoices({ included: {}, locks: {} });
  };

  const stepIndex = STEPS.findIndex(([s]) => s === step);
  const catalogueMessage = !status
    ? 'Starting…'
    : status.catalogue.error && !status.catalogue.ready
      ? `Couldn't download the card list from Scryfall (${status.catalogue.error}). Check your internet connection; MagicFinder will keep trying.`
      : !status.catalogue.ready
        ? `Downloading the card list from Scryfall (first run only)… ${Math.round(status.catalogue.progress * 100)}%`
        : null;
  const includedLines = parsed && settings ? parsed.lines.filter(l => isLineIncluded(l, choices, settings)) : [];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-4 sm:gap-6">
          <div className="font-bold text-lg whitespace-nowrap">🔮 MagicFinder</div>
          <ol className="hidden sm:flex gap-4 text-sm flex-1">
            {STEPS.map(([s, label], i) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={i > stepIndex && !(s === 'plan' && ladder)}
                  onClick={() => setStep(s === 'search' && ladder ? 'plan' : s)}
                  className={cx('flex items-center gap-2', i === stepIndex ? 'text-indigo-600 dark:text-indigo-300 font-semibold' : i < stepIndex ? '' : 'text-slate-400 dark:text-slate-600')}
                >
                  <span className={cx('w-6 h-6 rounded-full grid place-items-center text-xs', i <= stepIndex ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800')}>
                    {i < stepIndex ? '✓' : i + 1}
                  </span>
                  {label}
                </button>
              </li>
            ))}
          </ol>
          <div className="flex-1 sm:hidden" />
          <Button title="Switch light/dark" onClick={() => changeSettings({ theme: dark ? 'light' : 'dark' })}>{dark ? '☀' : '🌙'}</Button>
          <Button onClick={() => setSettingsOpen(true)} disabled={!settings}>⚙ Settings</Button>
        </div>
      </header>

      <main className="max-w-5xl w-full mx-auto px-4 py-6 flex-1">
        {hosted && connectionLost && (
          <div className="mb-4">
            <Notice tone="bad">
              Lost connection to MagicFinder. Reload the page; you may need to sign in again.{' '}
              <Button variant="accent" onClick={() => window.location.reload()}>Reload</Button>
            </Notice>
          </div>
        )}
        {error && <div className="mb-4"><Notice tone="bad">{error} <Button variant="link" onClick={() => setError(null)}>dismiss</Button></Notice></div>}
        {!hosted && status?.update && settings && settings.updateCheck.dismissed !== status.update.version && (
          <div className="mb-4">
            <Notice tone="info">
              MagicFinder {status.update.version} is available (you have {status.version}).{' '}
              <a className="underline font-medium" href={status.update.url} target="_blank" rel="noreferrer">Download · What's new</a>
              {' · '}
              <Button variant="link" onClick={() => changeSettings({ updateCheck: { ...settings.updateCheck, dismissed: status.update!.version } })}>not now</Button>
            </Notice>
          </div>
        )}
        {settings && step === 'list' && (
          <WantListStep
            text={text}
            onText={t => { setText(t); setDeckName(null); }}
            deckName={deckName}
            onImport={importDeck}
            parsed={parsed}
            choices={choices}
            onChoices={setChoices}
            settings={settings}
            onSettings={changeSettings}
            onFind={() => find()}
            busy={!status?.catalogue.ready}
            catalogueMessage={catalogueMessage}
            catalogueReady={!!status?.catalogue.ready}
            catalogueProgress={status?.catalogue.progress ?? 0}
          />
        )}
        {step === 'search' && <SearchStep progress={progress} queuedAhead={queuedAhead} lines={includedLines} />}
        {settings && step === 'plan' && ladder && runId && (
          <PlanStep
            runId={runId}
            ladder={ladder}
            selectedK={selectedK}
            onSelect={setSelectedK}
            choices={choices}
            onChoices={changeChoices}
            settings={settings}
            onSettings={changeSettings}
            onEdit={() => setStep('list')}
            onSearchAgain={() => find()}
          />
        )}
      </main>

      <footer className="text-[11px] text-slate-400 dark:text-slate-500 text-center px-4 py-4">
        Card images and data from Scryfall. Card images © Wizards of the Coast. MagicFinder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
        {status && <span className="block mt-1">MagicFinder {status.version}</span>}
      </footer>

      {settings && <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={changeSettings} hosted={hosted} />}
      {settings && askFirst && (
        <FirstVisit
          settings={settings}
          onDone={answers => {
            const next = { ...settings, ...answers };
            changeSettings(answers);
            store(SETTINGS_KEY, JSON.stringify(next));
            store(ASKED_KEY, '1');
            setAskFirst(false);
            void find(next);
          }}
          onClose={() => setAskFirst(false)}
        />
      )}
    </div>
  );
}

/** Hosted mode: asked once, before a friend's first search. Everything else can be changed later in Settings. */
function FirstVisit({ settings, onDone, onClose }: { settings: Settings; onDone: (answers: Pick<Settings, 'pickupCity' | 'ruralAddress'>) => void; onClose: () => void }) {
  const [pickupCity, setPickupCity] = useState(settings.pickupCity);
  const [ruralAddress, setRuralAddress] = useState(settings.ruralAddress);
  return (
    <Dialog open onClose={onClose} title="Before your first search">
      <div className="space-y-4 text-sm">
        <label className="block">Where are you?
          <select className="mt-1 block w-full border rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600" value={pickupCity} onChange={e => setPickupCity(e.target.value)}>
            {[...new Set([pickupCity, ...CITIES])].map(c => <option key={c}>{c}</option>)}
          </select>
          <span className="text-xs text-slate-500">Sets your region for postage prices, and Stores here get an "I'll pick up" switch.</span>
        </label>
        <Switch checked={ruralAddress} onChange={setRuralAddress} label="Rural delivery address" />
        <p className="text-xs text-slate-500">These are kept in this browser only. Change them, and everything else, any time in ⚙ Settings.</p>
        <div className="flex justify-end">
          <Button variant="accent" onClick={() => onDone({ pickupCity, ruralAddress })}>Search</Button>
        </div>
      </div>
    </Dialog>
  );
}
