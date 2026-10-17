// One run = one Want List searched once, then planned (and re-planned) as the buyer locks Printings, toggles
// pickup or changes settings. Re-planning reuses the run's Listings; only cards never searched are searched.
import type { Catalogue } from '../catalogue/catalogue';
import { StoreDirectory } from '../core/stores';
import { buyLines, resolveWantList, type ResolvedWantList } from '../core/wantList';
import { buildLadder, LadderKnowledge, type LadderState, type RungSolver } from '../optimiser/ladder';
import type { LadderView, PlanChoices, RunEvent, SearchProgressView } from '../shared/api';
import type { Source } from '../sources/types';
import type { CardKingdom } from './cardKingdom';
import { ladderView, listChoices, preparePlan, printingOptions, type PlanContext, type Prepared } from './planner';
import { searchAll, type SearchCard, type SearchResult } from './search';
import type { SearchCache } from './searchCache';
import type { SettingsStore } from './settings';

export interface RunDeps {
  catalogue: () => Catalogue;
  sources: Source[];
  cache: SearchCache;
  cardKingdom: CardKingdom;
  settings: SettingsStore;
  directory: () => StoreDirectory;
  solve: RungSolver;
  parallel: number;
  appVersion: string;
}

type Listener = (e: RunEvent) => void;

export class Run {
  readonly listeners = new Set<Listener>();
  progress: SearchProgressView | null = null;
  ladder: LadderView | null = null;
  search: SearchResult | null = null;
  choices: PlanChoices;
  private planId = 0;
  private searchAbort = new AbortController();
  private planAbort: AbortController | null = null;
  private prepared: Prepared | null = null;
  private knowledge: LadderKnowledge | null = null;
  private searching: Promise<void> | null = null;

  constructor(readonly id: string, readonly want: ResolvedWantList, choices: PlanChoices, private readonly deps: RunDeps) {
    this.choices = choices;
  }

  private emit(e: RunEvent) {
    if (e.type === 'progress') this.progress = e.progress;
    if (e.type === 'ladder') this.ladder = e.ladder;
    for (const l of this.listeners) l(e);
  }

  private ctx(): PlanContext {
    return { catalogue: this.deps.catalogue(), directory: this.deps.directory(), settings: this.deps.settings.get(), cardKingdom: this.deps.cardKingdom.context() };
  }

  /** Cards the current choices need, which this run hasn't searched yet. */
  private missingCards(): SearchCard[] {
    const lc = listChoices(this.choices, this.deps.settings.get());
    const need = new Map<string, string>();
    for (const b of buyLines(this.want.lines, lc)) need.set(b.oracleId, b.name);
    const have = this.searchedCards;
    return [...need].filter(([id]) => !have.has(id)).map(([oracleId, name]) => ({ oracleId, name }));
  }

  private searchedCards = new Set<string>();

  async start() {
    try {
      await this.searchMissing();
      await this.plan();
    } catch (e) {
      if (!this.searchAbort.signal.aborted) this.emit({ type: 'error', message: (e as Error).message });
    }
  }

  private async searchMissing() {
    const cards = this.missingCards();
    if (!cards.length) return;
    const settings = this.deps.settings;
    const result = await searchAll(
      cards,
      {
        catalogue: this.deps.catalogue(),
        sources: this.deps.sources,
        cache: this.deps.cache,
        settings: settings.get(),
        appVersion: this.deps.appVersion,
        onHealth: (source, blocked) => {
          const h = settings.get().sourceHealth[source];
          settings.update({
            sourceHealth: {
              ...settings.get().sourceHealth,
              [source]: blocked
                ? { blockedAt: new Date().toISOString(), consecutiveBlockedRuns: h.consecutiveBlockedRuns + 1 }
                : { blockedAt: null, consecutiveBlockedRuns: 0 },
            },
          });
        },
      },
      p => this.emit({ type: 'progress', progress: p }),
      this.searchAbort.signal,
    );
    for (const c of cards) this.searchedCards.add(c.oracleId);
    this.search = this.search ? mergeResults(this.search, result) : result;
  }

  /** Re-plans with new choices (locks, include toggles) or after a settings change. */
  async replan(choices?: PlanChoices) {
    if (choices) this.choices = choices;
    this.searching ??= this.searchMissing().finally(() => (this.searching = null));
    await this.searching;
    await this.plan();
  }

  private async plan() {
    if (!this.search) return;
    this.planAbort?.abort();
    const abort = (this.planAbort = new AbortController());
    const planId = ++this.planId;
    let ctx = this.ctx();
    const prepared = preparePlan(this.want, this.search, this.choices, ctx);
    const knowledge = new LadderKnowledge();
    this.prepared = prepared;
    this.knowledge = knowledge;
    const extras = { planId, want: this.want, search: this.search, choices: this.choices };
    let latest: LadderState | null = null;
    // CardKingdom prices only change what the Plan shows, so planning doesn't wait for their (large) download;
    // the latest view is sent again once they arrive.
    if (ctx.settings.cardKingdom.enabled) {
      void this.deps.cardKingdom.refresh().then(() => {
        if (abort.signal.aborted) return;
        ctx = this.ctx();
        if (latest) this.emit({ type: 'ladder', ladder: ladderView(prepared, latest, ctx, extras) });
      });
    }
    const solve: RungSolver = (p, k, o) => (abort.signal.aborted ? Promise.resolve({ kind: 'no-plan-in-time' }) : this.deps.solve(p, k, o));
    try {
      await buildLadder(prepared.problem, {
        solve,
        knowledge,
        timeLimitS: ctx.settings.rungTimeLimitS,
        parallel: this.deps.parallel,
        signal: abort.signal,
        onUpdate: state => {
          latest = state;
          if (!abort.signal.aborted) this.emit({ type: 'ladder', ladder: ladderView(prepared, state, ctx, extras) });
        },
      });
    } catch (e) {
      if (!abort.signal.aborted) throw e;
    }
  }

  /** "Try longer" on a rung that ran out of time. */
  async tryLonger(k: number) {
    const prepared = this.prepared;
    const knowledge = this.knowledge;
    if (!prepared || !knowledge || !this.search) return;
    const planId = this.planId;
    const ctx = this.ctx();
    const short = knowledge.kmin !== null && k < knowledge.kmin;
    const timeLimitS = ctx.settings.rungTimeLimitS * 6;
    const outcome = short
      ? await this.deps.solve(prepared.problem, k, { timeLimitS, partial: true, start: knowledge.short.get(k)?.plan })
      : await this.deps.solve(prepared.problem, k, { timeLimitS, start: knowledge.bestAtMost(k) ?? undefined });
    if (planId !== this.planId) return;
    if (short) knowledge.recordShort(k, outcome);
    else knowledge.record(k, outcome);
    this.emit({ type: 'ladder', ladder: ladderView(prepared, knowledge.state(true), ctx, { planId, want: this.want, search: this.search, choices: this.choices }) });
  }

  printings(lineId: string) {
    if (!this.search) return [];
    return printingOptions(this.want, this.search, lineId, this.choices, this.ctx());
  }

  cancel() {
    this.searchAbort.abort();
    this.planAbort?.abort();
  }
}

function mergeResults(a: SearchResult, b: SearchResult): SearchResult {
  const ids = new Set(a.listings.map(l => l.id));
  return {
    listings: [...a.listings, ...b.listings.filter(l => !ids.has(l.id))],
    unidentified: [...a.unidentified, ...b.unidentified],
    sources: a.sources.map(s => {
      const n = b.sources.find(x => x.source === s.source);
      if (!n) return s;
      const worse = n.status !== 'ok' && n.status !== 'off' ? n : s;
      return { ...worse, searched: s.searched + n.searched, notSearched: [...s.notSearched, ...n.notSearched], staleSince: s.staleSince ?? n.staleSince };
    }),
  };
}

export class RunManager {
  private runs = new Map<string, Run>();
  private next = 1;

  constructor(private readonly deps: RunDeps) {}

  start(text: string, choices: PlanChoices): Run {
    // One active run at a time keeps Source traffic low.
    for (const r of this.runs.values()) r.cancel();
    this.runs.clear();
    const want = resolveWantList(text, this.deps.catalogue());
    const run = new Run(String(this.next++), want, choices, this.deps);
    this.runs.set(run.id, run);
    void run.start();
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  /** Settings changed: re-plan the active run. */
  replanAll() {
    for (const r of this.runs.values()) void r.replan().catch(() => {});
  }
}
