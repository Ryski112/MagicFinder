// Development: the API server (restarts on change) plus Vite's dev server with hot reload, in one terminal.
import { spawn } from 'node:child_process';

const run = (cmd: string, args: string[]) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [
  run('npx', ['tsx', 'watch', '--disable-warning=ExperimentalWarning', 'src/server/main.ts', '--dev']),
  run('npx', ['vite', '--open']),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
