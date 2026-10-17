import { useCallback, useEffect, useRef, useState } from 'react';
import type { LadderView, ParseResponse, PlanChoices, SearchProgressView, Settings, StatusResponse } from '../shared/api';
import { api, followRun } from './api';
import { PlanStep } from './components/PlanStep';
import { SearchStep } from './components/SearchStep';
import { SettingsDrawer } from './components/SettingsDrawer';
import { Button, cx, Notice } from './components/ui';
import { isLineIncluded, WantListStep } from './components/WantListStep';

type Step = 'list' | 'search' | 'plan';
const STEPS: [Step, string][] = [['list', 'Want List'], ['search', 'Search'], ['plan', 'Choose a Plan']];
const DRAFT_KEY = 'magicfinder:draft';

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
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
  const [ladder, setLadder] = useState<LadderView | null>(null);
  const [selectedK, setSelectedK] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const stopFollowing = useRef<(() => void) | null>(null);

  // Status: wait for the card catalogue on first run.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      api.status().then(
        s => {
          setStatus(s);
          if (!s.catalogue.ready) timer = setTimeout(poll, 1500);
        },
        () => (timer = setTimeout(poll, 3000)),
      );
    poll();
    api.settings().then(setSettings, e => setError((e as Error).message));
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

  // Saves are batched briefly so typing a number doesn't re-plan on every keystroke.
  const pendingPatch = useRef<Partial<Settings>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(s => (s ? { ...s, ...patch } : s));
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
    if (runId && step === 'plan') api.replan(runId, c).catch(e => setError((e as Error).message));
  };

  const find = async () => {
    setError(null);
    setProgress(null);
    setLadder(null);
    setSelectedK(null);
    stopFollowing.current?.();
    try {
      const { runId: id } = await api.startRun(text, choices);
      setRunId(id);
      setStep('search');
      stopFollowing.current = followRun(id, e => {
        if (e.type === 'progress') setProgress(e.progress);
        else if (e.type === 'ladder') {
          setLadder(e.ladder);
          setStep(s => (s === 'search' ? 'plan' : s));
        } else setError(e.message);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
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
        {error && <div className="mb-4"><Notice tone="bad">{error} <Button variant="link" onClick={() => setError(null)}>dismiss</Button></Notice></div>}
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
            onFind={find}
            busy={!status?.catalogue.ready}
            catalogueMessage={catalogueMessage}
            catalogueReady={!!status?.catalogue.ready}
            catalogueProgress={status?.catalogue.progress ?? 0}
          />
        )}
        {step === 'search' && <SearchStep progress={progress} lines={includedLines} />}
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
            onSearchAgain={find}
          />
        )}
      </main>

      <footer className="text-[11px] text-slate-400 dark:text-slate-500 text-center px-4 py-4">
        Card images and data from Scryfall. Card images © Wizards of the Coast. MagicFinder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
        {status && <span className="block mt-1">MagicFinder {status.version}</span>}
      </footer>

      {settings && <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onChange={changeSettings} />}
    </div>
  );
}
