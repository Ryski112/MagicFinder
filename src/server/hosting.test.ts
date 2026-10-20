import { describe, expect, it } from 'vitest';
import { hostingFromEnv } from './hosting';

describe('hostingFromEnv', () => {
  it('keeps the desktop behaviour when nothing is set', () => {
    expect(hostingFromEnv({})).toEqual({ hosted: false, host: '127.0.0.1', solvers: undefined });
  });

  it('reads the image settings', () => {
    expect(hostingFromEnv({ MAGICFINDER_HOSTED: '1', MAGICFINDER_HOST: '0.0.0.0', MAGICFINDER_SOLVERS: '2' })).toEqual({
      hosted: true,
      host: '0.0.0.0',
      solvers: 2,
    });
  });

  it('treats 0 as off and ignores a solver count that is not a whole number of 1 or more', () => {
    expect(hostingFromEnv({ MAGICFINDER_HOSTED: '0' }).hosted).toBe(false);
    for (const s of ['0', '-1', '1.5', 'two']) expect(hostingFromEnv({ MAGICFINDER_SOLVERS: s }).solvers).toBeUndefined();
  });
});
