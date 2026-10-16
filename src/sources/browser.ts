// A headless Chrome page for Sources that only answer real browsers. Prefers the Chrome/Chromium/Edge the
// user already has; downloads Playwright's Chromium only when none is found.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium, type Browser, type Page } from 'playwright-core';
import { SourceError } from './types';
import type { HttpAnswer } from './policy';

const CANDIDATES: Record<string, string[]> = {
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ],
};

export function findInstalledBrowser(): string | null {
  if (process.env.MAGICFINDER_BROWSER && existsSync(process.env.MAGICFINDER_BROWSER)) return process.env.MAGICFINDER_BROWSER;
  return (CANDIDATES[process.platform] ?? []).find(p => p && existsSync(p)) ?? null;
}

async function installChromium(): Promise<void> {
  const cli = createRequire(import.meta.url).resolve('playwright-core/cli');
  console.log('No Chrome or Chromium found; downloading Chromium for MtgSingles (one-off)…');
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`Chromium download failed (${code})`))));
  });
}

async function launch(): Promise<Browser> {
  const executablePath = findInstalledBrowser();
  if (executablePath) return chromium.launch({ executablePath, headless: true });
  try {
    return await chromium.launch({ headless: true });
  } catch {
    await installChromium();
    return chromium.launch({ headless: true });
  }
}

export interface BrowserPage {
  fetchFromPage(url: string): Promise<HttpAnswer>;
  close(): Promise<void>;
}

const CHALLENGE_TITLE = /just a moment|attention required|access denied/i;

/** Opens `home` in a headless browser; requests are then made from inside that page. */
export async function openBrowserPage(home: string): Promise<BrowserPage> {
  let browser: Browser;
  try {
    browser = await launch();
  } catch (e) {
    throw new SourceError('down', `Couldn't start a browser: ${(e as Error).message}`);
  }
  let page: Page;
  try {
    page = await browser.newPage();
    const res = await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const title = await page.title();
    if (res?.status() === 403 || CHALLENGE_TITLE.test(title)) {
      throw new SourceError('blocked', `The site showed a bot check ("${title}")`);
    }
    if (!res || res.status() >= 500) throw new SourceError('down', `The site answered ${res?.status() ?? 'nothing'}`);
  } catch (e) {
    await browser.close().catch(() => {});
    if (e instanceof SourceError) throw e;
    throw new SourceError('down', (e as Error).message);
  }
  return {
    async fetchFromPage(url) {
      try {
        return await page.evaluate(async u => {
          const r = await fetch(u, { credentials: 'omit' });
          return { status: r.status, body: await r.text(), retryAfter: r.headers.get('retry-after'), contentType: r.headers.get('content-type') };
        }, url);
      } catch (e) {
        // A failed fetch inside the page (CORS failure, network error) usually means a block or an outage.
        return { status: 0, body: (e as Error).message, contentType: 'text/plain' };
      }
    },
    close: () => browser.close(),
  };
}
