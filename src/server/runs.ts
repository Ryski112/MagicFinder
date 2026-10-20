// One run = one Want List searched once, then planned (and re-planned) as the buyer locks Printings, toggles
// pickup or changes settings. Re-planning reuses the run's Listings; only cards never searched are searched.
import type { Catalogue } from '../catalogue/catalogue';
import { StoreDirectory } from '../core/stores';
import { buyLines, resolveWantList, type ResolvedWantList } from '../core/wantList';
import { buildLadder, LadderKnowledge, type LadderState, type RungSolver } from '../optimiser/ladder';
import type { RungOutcome, SolveOptions } from '../optimiser/milp';
import type { Problem } from '../optimiser/problem';
import type { SourceId } from '../core/types';
import type { LadderView, PlanChoices, RunEvent, SearchProgressView } from '../shared/api';
import type { Source } from '../sources/types';
import type { CardKingdom } from './cardKingdom';
import { ladderView, listChoices, preparePlan, printingOptions, type PlanContext, type Prepared } from './planner';
import { searchAll, type SearchCard, type SearchResult } from './search';
import { friendSettings } from './settings';
import type { SearchCache } from './searchCache';
import type { FriendSettings, Settings, SettingsStore } from './settings';

export interface RunDeps {
  catalogue: () => Catalogue;
  sources: Source[];
  cache: SearchCache;
  cardKingdom: CardKingdom;
  settings: SettingsStore;
  directory: () => StoreDirectory;
  /** Solves one rung; `owner` is the run, so runs sharing the solver pool take turns. */
  solve: (p: Problem, k: number, opts: SolveOptions, owner: string) => Promise<RungOutcome>;
  parallel: number;
  appVersion: string;
  /** Hosted mode: a block seen by one run applies to every run at once. */
  sharedBlocks?: boolean;
}

type Listener = (e: RunEvent) => void;

export class Run {
  readonly listeners = new Set<Listener>();
  progress: SearchProgressView | null = null;
  ladder: LadderView | null = null;
  /** Hosted mode: searches ahead of this one while it waits for a free slot (null once it has started). */
  queuedAhead: number | null = null;
  /** When the last stream closed (null while one is connected); a new run counts as idle until its page connects. */
  idleSince: number | null = Date.now();
  /** True while this run's Want List is being searched. */
  searchingNow = false;
  /** Set when the idle stop cut short a search or plan, so it is picked up again when the page comes back. */
  interrupted = false;
  /** Hosted mode: called when a stream connects, and to add the sharing line to a progress update. */
  onConnect: (() => void) | null = null;
  decorate: ((p: SearchProgressView) => SearchProgressView) | null = null;
  private working = 0;
  search: SearchResult | null = null;
  choices: PlanChoices;
  private planId = 0;
  private searchAbort = new AbortController();
  private planAbort: AbortController | null = null;
  private prepared: Prepared | null = null;
  private knowledge: LadderKnowledge | null = null;
  private searching: Promise<void> | null = null;

  /**
   * @param friend hosted mode: the settings this friend's browser sent, kept with the run so a re-plan after the
   * idle stop still works. Null on the desktop, where settings.json holds everything.
   */
  constructor(readonly id: string, readonly want: ResolvedWantList, choices: PlanChoices, private readonly deps: RunDeps, private friend: FriendSettings | null = null) {
    this.choices = choices;
  }

  /** The settings this run plans with: settings.json, with the friend's own preferences on top in hosted mode. */
  settings(): Settings {
    const server = this.deps.settings.get();
    return this.friend ? { ...server, ...this.friend } : server;
  }

  private emit(e: RunEvent) {
    if (e.type === 'progress') this.progress = e.progress = this.decorate ? this.decorate(e.progress) : e.progress;
    if (e.type === 'ladder') this.ladder = e.ladder;
    for (const l of this.listeners) l(e);
  }

  private ctx(): PlanContext {
    return { catalogue: this.deps.catalogue(), directory: this.deps.directory(), settings: this.settings(), cardKingdom: this.deps.cardKingdom.context() };
  }

  /** Cards the current choices need, which this run hasn't searched yet. */
  private missingCards(): SearchCard[] {
    const lc = listChoices(this.choices, this.settings());
    const need = new Map<string, string>();
    for (const b of buyLines(this.want.lines, lc)) need.set(b.oracleId, b.name);
    const have = this.searchedCards;
    return [...need].filter(([id]) => !have.has(id)).map(([oracleId, name]) => ({ oracleId, name }));
  }

  private searchedCards = new Set<string>();

  /** Follows this run's events until the returned function is called. */
  listen(l: Listener): () => void {
    this.listeners.add(l);
    this.idleSince = null;
    this.onConnect?.();
    return () => {
      this.listeners.delete(l);
      if (!this.listeners.size) this.idleSince = Date.now();
    };
  }

  async start() {
    const signal = this.searchAbort.signal;
    this.working++;
    try {
      await this.searchMissing();
      await this.plan();
    } catch (e) {
      if (!signal.aborted) this.emit({ type: 'error', message: (e as Error).message });
    } finally {
      this.working--;
    }
  }

  /** Hosted mode: tells the page how many searches are ahead of it in the queue. */
  setQueued(ahead: number | null) {
    this.queuedAhead = ahead;
    if (ahead !== null) this.emit({ type: 'queued', ahead });
  }

  private async searchMissing() {
    const cards = this.missingCards();
    if (!cards.length) return;
    const settings = this.deps.settings;
    const began = Date.now();
    this.searchingNow = true;
    const result = await searchAll(
      cards,
      {
        catalogue: this.deps.catalogue(),
        sources: this.deps.sources,
        cache: this.deps.cache,
        settings: this.settings(),
        appVersion: this.deps.appVersion,
        blockedElsewhere: this.deps.sharedBlocks
          ? source => {
              const at = Date.parse(settings.get().sourceHealth[source]?.blockedAt ?? '');
              return at >= began ? at : null;
            }
          : undefined,
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
    ).finally(() => (this.searchingNow = false));
    for (const c of cards) this.searchedCards.add(c.oracleId);
    this.search = this.search ? mergeResults(this.search, result) : result;
  }

  /** Re-plans with new choices (locks, include toggles) or after a settings change (in hosted mode, this friend's). */
  async replan(choices?: PlanChoices, friend?: FriendSettings) {
    if (choices) this.choices = choices;
    if (friend && this.friend) this.friend = friend;
    this.working++;
    try {
      this.searching ??= this.searchMissing().finally(() => (this.searching = null));
      await this.searching;
      await this.plan();
    } finally {
      this.working--;
    }
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
    const solve: RungSolver = (p, k, o) => (abort.signal.aborted ? Promise.resolve({ kind: 'no-plan-in-time' }) : this.deps.solve(p, k, o, this.id));
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
      ? await this.deps.solve(prepared.problem, k, { timeLimitS, partial: true, start: knowledge.short.get(k)?.plan }, this.id)
      : await this.deps.solve(prepared.problem, k, { timeLimitS, start: knowledge.bestAtMost(k) ?? undefined }, this.id);
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

  /** Hosted mode: another tab of the same browser started a newer search. */
  replace() {
    this.cancel();
    this.emit({ type: 'replaced' });
  }

  /** Hosted mode's idle stop: no more Source requests or solving, but the run can carry on later. */
  stop() {
    if (this.working > 0) this.interrupted = true;
    this.cancel();
    this.searchAbort = new AbortController();
    this.planAbort = null;
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

/** Hosted mode: how many searches run side by side, and the two idle timers. */
export interface HostedRunOptions {
  maxActive: number;
  idleStopMs: number;
  idleDropMs: number;
}

export const HOSTED_RUNS: HostedRunOptions = { maxActive: 10, idleStopMs: 2 * 60 * 1000, idleDropMs: 30 * 60 * 1000 };

/** Rough seconds per live card search until one has been measured (MtgSingles pages ~1.8 times a card, 1.5 s apart). */
const SECONDS_PER_CARD: Record<SourceId, number> = { mtgsingles: 2.7, fetch: 1.2 };

export class RunManager {
  private runs = new Map<string, Run>();
  private next = 1;
  /** Hosted mode only: each browser's current run, the runs searching now, and the ones waiting for a slot. */
  private byBrowser = new Map<string, Run>();
  private active = new Set<Run>();
  private waiting: Run[] = [];
  /** Hosted mode only: measured seconds between live card searches on each Source, whichever runs asked. */
  private secondsPerCard = new Map<SourceId, number>();
  private lastAnswer = new Map<SourceId, number>();
  private readonly deps: RunDeps;

  constructor(deps: RunDeps, private readonly hosted: HostedRunOptions | null = null) {
    this.deps = hosted ? { ...deps, sources: deps.sources.map(src => this.timed(src)), sharedBlocks: true } : deps;
  }

  get isHosted() {
    return !!this.hosted;
  }

  /** Desktop: a new search cancels every run. Hosted: it replaces only the same browser's run. */
  start(text: string, choices: PlanChoices, browserId?: string, friend?: FriendSettings): Run {
    const want = resolveWantList(text, this.deps.catalogue());
    const run = new Run(String(this.next++), want, choices, this.deps, this.hosted ? (friend ?? friendSettings({})) : null);
    if (!this.hosted) {
      // One active run at a time keeps Source traffic low.
      for (const r of this.runs.values()) r.cancel();
      this.runs.clear();
      this.runs.set(run.id, run);
      void run.start();
      return run;
    }
    const key = browserId || `run:${run.id}`;
    const previous = this.byBrowser.get(key);
    if (previous) {
      this.forget(previous);
      previous.replace();
    }
    this.byBrowser.set(key, run);
    this.runs.set(run.id, run);
    run.onConnect = () => {
      if (run.interrupted && !this.active.has(run) && !this.waiting.includes(run)) {
        run.interrupted = false;
        this.enqueue(run);
      }
    };
    run.decorate = p => this.withSharing(run, p);
    this.enqueue(run);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  /** Hosted mode: the browser's current run, while it is still alive (searching, or idle for less than 30 min). */
  forBrowser(browserId: string): Run | undefined {
    return this.hosted ? this.byBrowser.get(browserId) : undefined;
  }

  /** Settings changed: re-plan the active run. Desktop only; in hosted mode each browser re-plans its own run. */
  replanAll() {
    for (const r of this.runs.values()) void r.replan().catch(() => {});
  }

  /** Hosted mode: stops runs nobody has watched for a while, then drops them. Called every few seconds. */
  sweep(now = Date.now()) {
    if (!this.hosted) return;
    for (const run of this.runs.values()) {
      if (run.idleSince === null) continue;
      const idle = now - run.idleSince;
      if (idle >= this.hosted.idleDropMs) {
        this.forget(run);
        run.cancel();
      } else if (idle >= this.hosted.idleStopMs && (this.active.has(run) || this.waiting.includes(run))) {
        const queued = this.waiting.includes(run);
        this.waiting = this.waiting.filter(r => r !== run);
        run.stop();
        // A run stopped while still queued never started, so it starts when its page comes back.
        if (queued) run.interrupted = true;
        this.drain();
      }
    }
  }

  private forget(run: Run) {
    this.runs.delete(run.id);
    for (const [k, r] of this.byBrowser) if (r === run) this.byBrowser.delete(k);
    if (this.waiting.includes(run)) {
      this.waiting = this.waiting.filter(r => r !== run);
      this.drain();
    }
  }

  private enqueue(run: Run) {
    this.waiting.push(run);
    this.drain();
  }

  /** Starts waiting runs while there is a free slot, then tells the rest how many are ahead of them. */
  private drain() {
    while (this.waiting.length && this.active.size < this.hosted!.maxActive) {
      const run = this.waiting.shift()!;
      this.active.add(run);
      run.setQueued(null);
      void run.start().finally(() => {
        this.active.delete(run);
        this.drain();
      });
    }
    this.waiting.forEach((r, i) => r.setQueued(i + 1));
  }

  /** Measures how fast each Source gets through live card searches, whoever asked for them. */
  private timed(src: Source): Source {
    return {
      id: src.id,
      name: src.name,
      close: src.close?.bind(src),
      search: async (q, signal) => {
        try {
          return await src.search(q, signal);
        } finally {
          const now = Date.now();
          const last = this.lastAnswer.get(src.id);
          this.lastAnswer.set(src.id, now);
          // Only back-to-back answers say anything about the pace; a long gap means nobody was searching.
          if (last !== undefined && now - last < 60_000) {
            const prev = this.secondsPerCard.get(src.id) ?? SECONDS_PER_CARD[src.id];
            this.secondsPerCard.set(src.id, 0.8 * prev + 0.2 * ((now - last) / 1000));
          }
        }
      },
    };
  }

  /** Cards left for `run` on each Source, while it is still searching that Source. */
  private remaining(run: Run, source: SourceId): number {
    const p = run.progress;
    const st = p?.sources.find(s => s.source === source);
    if (!run.searchingNow || !p || !st || st.status !== 'ok') return 0;
    return Math.max(0, p.total - st.searched - st.notSearched.length);
  }

  /** Adds "shared with N other searches · about X min left" to each Source other runs are also using. */
  private withSharing(run: Run, p: SearchProgressView): SearchProgressView {
    return {
      ...p,
      sources: p.sources.map(st => {
        const mine = st.status === 'ok' ? Math.max(0, p.total - st.searched - st.notSearched.length) : 0;
        if (!mine) return st;
        let others = 0;
        let ahead = mine;
        for (const r of this.active) {
          if (r === run) continue;
          const theirs = this.remaining(r, st.source);
          if (!theirs) continue;
          others++;
          // The throttle takes turns, so another run slows this one down until either has finished.
          ahead += Math.min(theirs, mine);
        }
        if (!others) return st;
        const perCard = this.secondsPerCard.get(st.source) ?? SECONDS_PER_CARD[st.source];
        return { ...st, sharedWith: others, minutesLeft: Math.max(1, Math.ceil((ahead * perCard) / 60)) };
      }),
    };
  }
}
