import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizePath, summarize } from '../../scripts/rea-session-report.mjs';

test('removes URL secrets and masks identifier segments', () => {
  assert.equal(sanitizePath('https://www.mexc.com/exchange/MX_USDT?token=secret#hidden'), '/exchange/MX_USDT');
  assert.equal(sanitizePath('/wallet/123456789?balance=42'), '/wallet/:redacted');
});
test('handles malformed lines and emits only aggregate counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rea-report-'));
  try {
    const input = join(dir, 'events.jsonl');
    await writeFile(input, [
      JSON.stringify({ kind: 'click', url: 'https://www.mexc.com/exchange/MX_USDT?token=secret', value: 'PRIVATE' }),
      'broken-json',
      JSON.stringify({ kind: 'heartbeat', page: { path: '/futures/BTC_USDT' }, password: 'SHH' }),
    ].join('\n'));
    const report = await summarize(input);
    assert.equal(report.invalidLines, 1);
    assert.equal(report.eventCounts.click, 1);
    assert.deepEqual(report.pagePaths, ['/exchange/MX_USDT', '/futures/BTC_USDT']);
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(report).includes('secret'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
