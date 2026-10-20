import { describe, expect, it } from 'vitest';
import { DailyRequestCount, nzDay } from './requestCount';

describe('DailyRequestCount', () => {
  it('counts requests per Source and reports each NZ day once it is over', () => {
    // 2026-10-21 23:00 in Auckland (NZDT, UTC+13).
    let now = Date.parse('2026-10-21T10:00:00Z');
    const days: string[] = [];
    const count = new DailyRequestCount(() => now);
    count.onDayEnd = l => days.push(l);
    count.count('MtgSingles');
    count.count('MtgSingles');
    count.count('Fetch TCG');
    expect(count.line()).toBe('Source requests on 2026-10-21: MtgSingles 2, Fetch TCG 1');
    count.rollover();
    expect(days).toEqual([]);
    now += 2 * 60 * 60 * 1000; // 01:00 the next morning in Auckland
    count.rollover();
    expect(days).toEqual(['Source requests on 2026-10-21: MtgSingles 2, Fetch TCG 1']);
    count.count('Fetch TCG');
    expect(count.line()).toBe('Source requests on 2026-10-22: Fetch TCG 1');
  });

  it('uses the NZ date, not UTC', () => {
    expect(nzDay(Date.parse('2026-10-21T12:30:00Z'))).toBe('2026-10-22');
  });
});
