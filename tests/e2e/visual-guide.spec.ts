import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function signIn(page: Page, name = 'Admin Demo') {
  await page.goto('/masuk');
  await page.getByRole('button', { name: `Masuk sebagai ${name}`, exact: true }).click();
  await expect(page).toHaveURL(/ringkasan$/);
}

function detail(page: Page) {
  return page.locator('[data-testid^="guide-detail-"]:visible');
}

test('visual guide explains all diagrams without issuing operational commands', async ({ page }, testInfo) => {
  await signIn(page);
  const mutations: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(request.url());
  });
  await page.goto('/panduan');
  const guide = page.getByTestId('prototype-guide');
  await expect(guide.getByRole('heading', { level: 1 })).toHaveText('Cara kerja Lumbung');
  const maps = [
    ['Alur lengkap', 'journey', 15], ['Keputusan alokasi', 'allocation', 7],
    ['Alur gudang', 'warehouse', 10], ['Arsitektur sistem', 'architecture', 10],
    ['Pesan & pekerjaan latar', 'background', 7], ['Peta data', 'records', 7],
  ] as const;
  for (const [label, id, count] of maps) {
    await guide.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('[data-node-id]')).toHaveCount(count);
    if (id !== 'journey') await expect(page).toHaveURL(new RegExp(`view=${id}`));
    const last = page.locator('[data-node-id]').last();
    await last.click();
    await expect(last).toHaveAttribute('aria-pressed', 'true');
    await expect(detail(page).getByRole('heading', { level: 3 })).toBeVisible();
    await expect(detail(page)).toContainText('Jika belum bisa lanjut');
    await detail(page).getByText('Referensi implementasi', { exact: true }).click();
    await expect(detail(page).locator('code').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const a11y = await new AxeBuilder({ page }).include('[data-testid="prototype-guide"]').analyze();
    expect(a11y.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${id}.png`), fullPage: true });
  }
  const downloaded = page.waitForEvent('download');
  await guide.getByRole('button', { name: 'Unduh dokumentasi' }).click();
  const file = await downloaded;
  const path = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(path);
  const markdown = await readFile(path, 'utf8');
  expect(markdown.match(/```mermaid/g)).toHaveLength(6);
  expect(markdown).toContain('PostgreSQL 17');
  expect(markdown).toContain('Setujui pengiriman');
  expect(mutations).toEqual([]);
});

test('manual steps, playback, keyboard navigation, and English work together', async ({ page }, testInfo) => {
  await signIn(page);
  await page.goto('/panduan');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How Lumbung works', exact: true })).toBeVisible();
  await page.locator('[data-node-id="flo"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-node-id="intake"]')).toBeFocused();
  await expect(detail(page)).toContainText('120 portions');
  if (testInfo.project.name === 'mobile') {
    // Collapsing the previous inline explanation must reveal the new step's start,
    // rather than leaving the user at the bottom of a different explanation.
    await expect.poll(async () => {
      const heading = await detail(page).getByRole('heading', { level: 3 }).boundingBox();
      return !!heading && heading.y >= 180 && heading.y < 650;
    }).toBe(true);
  }
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.locator('[data-node-id="safety"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await new AxeBuilder({ page }).include('[data-testid="prototype-guide"]').analyze()).violations).toEqual([]);

  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Follow automatically', exact: true }).click();
  await page.clock.fastForward(6100);
  await expect(page.locator('[data-node-id="match"]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.clock.fastForward(12000);
  await expect(page.locator('[data-node-id="match"]')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('tab', { name: 'System architecture', exact: true }).click();
  await page.locator('[data-node-id="postgres"]').click();
  await expect(detail(page)).toContainText('RLS isolates tenants');
  await detail(page).getByRole('button', { name: 'Separate worker', exact: true }).click();
  await expect(page.locator('[data-node-id="worker"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(detail(page)).toContainText('npm run worker');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'System architecture', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'System architecture', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Messages & background work', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('guide-english.png'), fullPage: true });
});

test('guide is authenticated and related-screen links respect the current role', async ({ page }) => {
  await page.goto('/panduan?view=architecture');
  await expect(page).toHaveURL(/masuk/);
  await signIn(page, 'Gudang Demo 1');
  await page.goto('/panduan');
  await page.locator('[data-node-id="outreach"]').click();
  await expect(detail(page)).toContainText('Layar ini memerlukan hak akses peran lain.');
  await expect(detail(page).getByRole('link', { name: 'Buka layar terkait' })).toHaveCount(0);
  await page.goto('/panduan?view=unknown');
  await expect(page.getByRole('tab', { name: 'Alur lengkap', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('disabling the guide removes the link and rejects direct access', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_MANAGED !== '1', 'Requires the isolated test server/database environment.');
  await signIn(page);
  const port = await new Promise<number>((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      if (!address || typeof address === 'string') { socket.close(); reject(new Error('No port')); return; }
      socket.close(() => resolve(address.port));
    });
  });
  const alternate = new URL(baseURL!);
  alternate.port = String(port);
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    env: { ...process.env, APP_BASE_URL: alternate.origin, PROTOTYPE_GUIDE_ENABLED: 'false' }, stdio: 'ignore',
  });
  const stopped = new Promise<void>(resolve => server.once('exit', () => resolve()));
  try {
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error('Disabled-guide server exited');
      try { return (await fetch(`${alternate.origin}/api/health`)).status; } catch { return 0; }
    }, { timeout: 20000 }).toBe(200);
    const response = await page.goto(`${alternate.origin}/panduan`);
    await expect(page.getByTestId('prototype-guide')).toHaveCount(0);
    expect(response?.status()).toBe(404);
    await page.goto(`${alternate.origin}/ringkasan`);
    await expect(page.locator('#app-sidebar a[href="/panduan"]')).toHaveCount(0);
  } finally {
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 5000);
    await stopped;
    clearTimeout(force);
  }
});
