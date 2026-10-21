import { useEffect, useState } from 'react';
import type { Settings, SourceId, StoreChoice } from '../../shared/api';
import { api } from '../api';
import { Button, Notice, Sheet, SOURCE_NAME, Switch } from './ui';

export const CITIES = ['Auckland', 'Hamilton', 'Tauranga', 'Wellington', 'Palmerston North', 'Napier', 'New Plymouth', 'Whangārei', 'Christchurch', 'Dunedin', 'Nelson', 'Queenstown', 'Invercargill'];
const field = 'mt-1 block w-full border rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600';

/** Searches are reused for an hour; this forgets them so the next search asks the Sources again. */
function ClearCache() {
  const [state, setState] = useState<{ busy?: boolean; message?: string }>({});
  const clear = async () => {
    setState({ busy: true });
    try {
      const { cleared } = await api.clearCache();
      setState({ message: cleared ? `Cleared ${cleared} saved search${cleared > 1 ? 'es' : ''}. Search again to get fresh stock.` : 'Nothing saved to clear.' });
    } catch (e) {
      setState({ message: (e as Error).message });
    }
  };
  return (
    <div>
      <Button variant="link" disabled={state.busy} onClick={clear}>Clear saved searches</Button>
      <span className="block text-xs text-slate-500">{state.message ?? 'Searches are reused for an hour. Clear them to see stock that changed since.'}</span>
    </div>
  );
}

/** Stores the buyer can collect from for free: no postage, and they don't use up the 1/2/3-Store limit. */
function PreferredStores({ preferred, city, on, onToggle, onChange }: { preferred: Settings['preferredStores']; city: string; on: boolean; onToggle: (v: boolean) => void; onChange: (b: Settings['preferredStores']) => void }) {
  const [choices, setChoices] = useState<StoreChoice[]>([]);
  useEffect(() => {
    api.stores().then(setChoices).catch(() => setChoices([]));
  }, []);
  const ids = Object.keys(preferred);
  const near = (s: StoreChoice) => s.city?.toLowerCase() === city.toLowerCase();
  const options = choices.filter(s => !preferred[s.id] && s.country === 'NZ').sort((a, b) => Number(near(b)) - Number(near(a)) || a.name.localeCompare(b.name));
  return (
    <div className="space-y-1">
      <div className="font-medium">Preferred Stores</div>
      {ids.length > 0 && <Switch checked={on} onChange={onToggle} label="Use my preferred Stores" />}
      <span className="block text-xs text-slate-500">Stores you can collect from easily. Their cards cost no postage and they don't count toward your 1, 2 or 3 Store limit. You can also use ☆ Prefer on the Plan screen.</span>
      {ids.length > 0 && (
        <ul className="space-y-1">
          {ids.map(id => (
            <li key={id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate">★ {preferred[id]}</span>
              <Button variant="link" className="text-xs" onClick={() => onChange(Object.fromEntries(ids.filter(x => x !== id).map(x => [x, preferred[x]])))}>remove</Button>
            </li>
          ))}
        </ul>
      )}
      {options.length > 0 && (
        <select className={field} value="" aria-label="Add a preferred Store"
          onChange={e => {
            const s = choices.find(c => c.id === e.target.value);
            if (s) onChange({ ...preferred, [s.id]: s.name });
          }}>
          <option value="">Add a Store…</option>
          {options.map(s => <option key={s.id} value={s.id}>{s.name}{s.city ? ` (${s.city})` : ''}{near(s) ? ' · near you' : ''}</option>)}
        </select>
      )}
    </div>
  );
}

function ExcludedStores({ excluded, onChange }: { excluded: Settings['excludedStores']; onChange: (b: Settings['excludedStores']) => void }) {
  const ids = Object.keys(excluded);
  if (!ids.length) return null;
  return (
    <details>
      <summary className="cursor-pointer">Excluded Stores ({ids.length})</summary>
      <ul className="mt-1 space-y-1">
        {ids.map(id => (
          <li key={id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 min-w-0 truncate">{excluded[id]}</span>
            <Button variant="link" className="text-xs" onClick={() => onChange(Object.fromEntries(ids.filter(x => x !== id).map(x => [x, excluded[x]])))}>use again</Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function BlockedPrintings({ blocked, onChange }: { blocked: Settings['blockedPrintings']; onChange: (b: Settings['blockedPrintings']) => void }) {
  const ids = Object.keys(blocked);
  if (!ids.length) return <span className="block text-xs text-slate-500">Printings you mark "Never buy" on the Plan screen are listed here.</span>;
  return (
    <details>
      <summary className="cursor-pointer">Never-buy Printings ({ids.length})</summary>
      <ul className="mt-1 space-y-1">
        {ids.map(id => (
          <li key={id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 min-w-0 truncate">{blocked[id]}</span>
            <Button variant="link" className="text-xs" onClick={() => onChange(Object.fromEntries(ids.filter(x => x !== id).map(x => [x, blocked[x]])))}>allow again</Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SettingsDrawer({ open, onClose, settings, onChange, hosted = false }: { open: boolean; onClose: () => void; settings: Settings; onChange: (patch: Partial<Settings>) => void; hosted?: boolean }) {
  const s = settings;
  const repeatedBlocks = (Object.keys(s.sourceHealth) as SourceId[]).filter(id => s.sources[id] && s.sourceHealth[id].consecutiveBlockedRuns >= 3);
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-4 text-sm">
        {repeatedBlocks.map(id => (
          <Notice key={id} tone="warn">
            {SOURCE_NAME[id]} has blocked the last {s.sourceHealth[id].consecutiveBlockedRuns} runs.{' '}
            <Button variant="link" onClick={() => onChange({ sources: { ...s.sources, [id]: false } })}>Turn off {SOURCE_NAME[id]}</Button>
          </Notice>
        ))}

        <label className="block">Postage type
          <select className={field} value={s.postageType} onChange={e => onChange({ postageType: e.target.value as Settings['postageType'] })}>
            <option value="tracked">Tracked (default)</option>
            <option value="standard">Standard (cheapest, may be untracked)</option>
          </select>
        </label>

        <label className="block">Pickup city
          <select className={field} value={s.pickupCity} onChange={e => onChange({ pickupCity: e.target.value })}>
            {[...new Set([s.pickupCity, ...CITIES])].map(c => <option key={c}>{c}</option>)}
          </select>
          <span className="text-xs text-slate-500">Stores here get an "I'll pick up" switch. Also sets your region for postage prices.</span>
        </label>

        <PreferredStores preferred={s.preferredStores} city={s.pickupCity} on={s.preferredOn} onToggle={preferredOn => onChange({ preferredOn })} onChange={preferredStores => onChange({ preferredStores })} />

        <Switch checked={s.ruralAddress} onChange={v => onChange({ ruralAddress: v })} label="Rural delivery address" />

        <label className="block">Minimum condition
          <select className={field} value={s.minCondition} onChange={e => onChange({ minCondition: e.target.value as Settings['minCondition'] })}>
            <option value="NM">Near Mint</option>
            <option value="LP">Lightly Played or better (default)</option>
            <option value="MP">Moderately Played or better</option>
            <option value="HP">Heavily Played or better</option>
          </select>
        </label>

        <div className="flex flex-col gap-3">
          <Switch checked={s.allowFoils} onChange={v => onChange({ allowFoils: v })} label="Allow foils" />
          <Switch checked={s.useListPrintings} onChange={v => onChange({ useListPrintings: v })} label="Use the Printings from my list" />
          <Switch checked={s.includeBasics} onChange={v => onChange({ includeBasics: v })} label="Include basic lands" />
          <BlockedPrintings blocked={s.blockedPrintings} onChange={blockedPrintings => onChange({ blockedPrintings })} />
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 flex flex-col gap-3">
          <Switch checked={s.sources.fetch} onChange={v => onChange({ sources: { ...s.sources, fetch: v } })} label="Search Fetch TCG" />
          <Switch checked={s.sources.mtgsingles} onChange={v => onChange({ sources: { ...s.sources, mtgsingles: v } })} label="Search MtgSingles" />
          <Switch checked={s.sources['mtgsingles-au']} onChange={v => onChange({ sources: { ...s.sources, 'mtgsingles-au': v } })} label="Include Australian Stores (MtgSingles AU)" />
          {s.sources['mtgsingles-au'] && (
            <label className="block">Australian Store postage to NZ (NZ$)
              <input type="number" min={0} step={1} className={field} value={s.australiaPostage}
                onChange={e => onChange({ australiaPostage: Number(e.target.value) })} />
              <span className="text-xs text-slate-500">A guess for each Australian Store. Prices are converted from AUD. Not every Store ships to NZ: use "Doesn't ship to NZ" on the Plan screen to drop one.</span>
            </label>
          )}
          <ExcludedStores excluded={s.excludedStores} onChange={excludedStores => onChange({ excludedStores })} />
          {/* Hosted mode: the cache is shared by everyone and at most an hour old. */}
          {!hosted && <ClearCache />}
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 flex flex-col gap-3">
          <Switch checked={s.cardKingdom.enabled} onChange={v => onChange({ cardKingdom: { ...s.cardKingdom, enabled: v } })} label="Compare with CardKingdom" />
          <label className="block">CardKingdom shipping to NZ (US$)
            <input type="number" min={0} step={1} className={field} value={s.cardKingdom.shippingUsd}
              onChange={e => onChange({ cardKingdom: { ...s.cardKingdom, shippingUsd: Number(e.target.value) } })} />
            <span className="text-xs text-slate-500">A flat estimate; CardKingdom only quotes the real figure at checkout.</span>
          </label>
          <Switch checked={s.cardKingdom.addGst} onChange={v => onChange({ cardKingdom: { ...s.cardKingdom, addGst: v } })} label="Add 15% GST to CardKingdom prices" />
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 grid grid-cols-2 gap-3">
          <label className="block">Default postage
            <input type="number" min={0} step={0.5} className={field} value={s.defaultPostage.tracked}
              onChange={e => onChange({ defaultPostage: { ...s.defaultPostage, tracked: Number(e.target.value) } })} />
          </label>
          <label className="block">Rural extra
            <input type="number" min={0} step={0.5} className={field} value={s.defaultPostage.rural}
              onChange={e => onChange({ defaultPostage: { ...s.defaultPostage, rural: Number(e.target.value) } })} />
          </label>
          <p className="col-span-2 text-xs text-slate-500">Used for Stores that don't publish postage; shown as "est.".</p>
        </div>

        {Object.keys(s.postageOverrides).length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <div className="font-medium mb-1">Your postage prices</div>
            <ul className="space-y-1">
              {Object.entries(s.postageOverrides).map(([id, v]) => (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{id}</span>
                  <span className="tabnum">${v.toFixed(2)}</span>
                  <Button variant="link" onClick={() => {
                    const next = { ...s.postageOverrides };
                    delete next[id];
                    onChange({ postageOverrides: next });
                  }}>remove</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
