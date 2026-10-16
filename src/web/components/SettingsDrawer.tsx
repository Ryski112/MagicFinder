import type { Settings, SourceId } from '../../shared/api';
import { Button, Notice, Sheet, SOURCE_NAME, Switch } from './ui';

const CITIES = ['Auckland', 'Hamilton', 'Tauranga', 'Wellington', 'Palmerston North', 'Napier', 'New Plymouth', 'Whangārei', 'Christchurch', 'Dunedin', 'Nelson', 'Queenstown', 'Invercargill'];
const field = 'mt-1 block w-full border rounded-md px-2 py-1.5 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600';

export function SettingsDrawer({ open, onClose, settings, onChange }: { open: boolean; onClose: () => void; settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
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
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 flex flex-col gap-3">
          <Switch checked={s.sources.fetch} onChange={v => onChange({ sources: { ...s.sources, fetch: v } })} label="Search Fetch TCG" />
          <Switch checked={s.sources.mtgsingles} onChange={v => onChange({ sources: { ...s.sources, mtgsingles: v } })} label="Search MtgSingles" />
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
