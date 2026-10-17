import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { choosePort } from './instance';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(r => s.close(r))));
});

/** Occupies a port with a server answering /api/status with `body`. */
function occupy(port: number, body: unknown): Promise<void> {
  const s = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/api/status' ? JSON.stringify(body) : '{}');
  });
  servers.push(s);
  return new Promise(r => s.listen(port, '127.0.0.1', () => r()));
}

describe('choosePort', () => {
  it('uses the first port when nothing is running', async () => {
    expect(await choosePort(5310, 5)).toEqual({ free: 5310 });
  });

  it('finds a MagicFinder that is already running', async () => {
    await occupy(5320, { app: 'MagicFinder', version: '0.2.0' });
    expect(await choosePort(5320, 5)).toEqual({ running: 5320 });
  });

  it('steps past ports used by other programs', async () => {
    await occupy(5330, { hello: 'world' });
    await occupy(5331, 'not json');
    expect(await choosePort(5330, 5)).toEqual({ free: 5332 });
  });

  it('finds a running MagicFinder behind another program', async () => {
    await occupy(5340, { hello: 'world' });
    await occupy(5341, { app: 'MagicFinder', version: '0.2.0' });
    expect(await choosePort(5340, 5)).toEqual({ running: 5341 });
  });
});
