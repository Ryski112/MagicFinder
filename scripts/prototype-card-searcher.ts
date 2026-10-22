// PROTOTYPE (throwaway): the card searcher variants with hot reload, on the git-ignored preview data, not the real profile.
// `npm run prototype:card-searcher`, then flip variants with the bar at the bottom or ← →. `--no-open` skips the browser.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const env = { ...process.env, MAGICFINDER_DATA_DIR: resolve('.magicfinder-data') };
const run = (cmd: string, args: string[]) => spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
const open = process.argv.includes('--no-open') ? [] : ['--open', '/?variant=A'];
const procs = [
  run('npx', ['tsx', 'watch', '--disable-warning=ExperimentalWarning', 'src/server/main.ts', '--dev']),
  run('npx', ['vite', '--port', '5191', '--strictPort', ...open]),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
