// Switches for hosted mode: MagicFinder in a Docker image on the owner's NAS, shared by friends through Cloudflare
// Tunnel + Access. The image sets them; the desktop never does, so unset means today's behaviour. Decided in "Which
// image setup, and how does the owner run and update it on the DS423?".

export interface Hosting {
  /** MAGICFINDER_HOSTED: every hosted-only behaviour (searches side by side, settings in the browser, no update notice). */
  hosted: boolean;
  /** MAGICFINDER_HOST: the address to listen on. The image listens on every address so its published port works. */
  host: string;
  /** MAGICFINDER_SOLVERS: worker threads for exact rung solves; undefined keeps the pool's own default. */
  solvers: number | undefined;
}

export function hostingFromEnv(env: NodeJS.ProcessEnv = process.env): Hosting {
  const solvers = Number(env.MAGICFINDER_SOLVERS);
  if (env.MAGICFINDER_SOLVERS && !(Number.isInteger(solvers) && solvers >= 1)) {
    console.warn(`MAGICFINDER_SOLVERS=${env.MAGICFINDER_SOLVERS} isn't a whole number of 1 or more; using the default.`);
  }
  return {
    hosted: !!env.MAGICFINDER_HOSTED && env.MAGICFINDER_HOSTED !== '0',
    host: env.MAGICFINDER_HOST || '127.0.0.1',
    solvers: Number.isInteger(solvers) && solvers >= 1 ? solvers : undefined,
  };
}
