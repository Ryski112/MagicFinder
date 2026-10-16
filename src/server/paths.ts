import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/** Where MagicFinder keeps the catalogue, search cache and settings for this user. */
export function dataDir(): string {
  const dir =
    process.env.MAGICFINDER_DATA_DIR ??
    (process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'MagicFinder')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'MagicFinder')
        : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'magicfinder'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const USER_AGENT = 'MagicFinder/0.1 (personal price finder; https://github.com/Ryski112/MagicFinder)';
