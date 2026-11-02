import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function checkSpotlight(page: import('@playwright/test').Page) {
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-tour-active="true"]')).toHaveCount(1);
  await expect.poll(async () => {
    const target = await page.locator('[data-tour-active="true"]').boundingBox();
    const ring = await page.getByTestId('tour-spotlight').boundingBox();
    const tip = await page.getByRole('dialog').boundingBox();
    if (!target || !ring || !tip) return false;
    const overlap = tip.x < ring.x + ring.width && tip.x + tip.width > ring.x && tip.y < ring.y + ring.height && tip.y + tip.height > ring.y;
    return !overlap && Math.abs(target.x - ring.x) <= 8 && Math.abs(target.y - ring.y) <= 8 && tip.x >= 0 && tip.y >= 0;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('spotlight tour points at specific controls, survives reload, and never submits changes', async ({ page }, testInfo) => {
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Masuk sebagai Admin Demo', exact: true }).click();
  await expect(page).toHaveURL(/ringkasan/);
  const mutations: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(request.url());
  });
  const launcher = page.getByRole('complementary', { name: 'Panduan aplikasi' });
  const dialog = page.getByRole('dialog');
  await launcher.getByRole('button', { name: 'Mulai panduan' }).click();
  await expect(dialog.getByRole('heading', { name: 'Periksa waktu operasi' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Kembali', exact: true })).toBeDisabled();
  await checkSpotlight(page);
  await expect(page.locator('[data-tour="clock"]')).toHaveAttribute('data-tour-active', 'true');
  await page.screenshot({ path: testInfo.outputPath('spotlight-clock.png') });
  const journey = [
    ['/ringkasan', 'Buka pekerjaan dari angka ini'], ['/flo', 'Cari organisasi penerima'], ['/flo', 'Buka profil FLO ini'],
    ['/donasi', 'Temukan donasi yang ingin diproses'], ['/donasi', 'Buka rincian donasi'],
    ['/rekomendasi', 'Baca alasan rekomendasi ini'], ['/persetujuan', 'Tinjau sebelum menyetujui'],
    ['/pengiriman', 'Periksa pengiriman ini'], ['/pelaporan', 'Perhatikan batas pelaporan ini'],
    ['/persediaan', 'Bedakan tiga saldo ini'], ['/persediaan', 'Buka rincian saldo di sini'], ['/pesan', 'Buka percakapan FLO ini'],
  ];
  for (const [path, title] of journey) {
    await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await checkSpotlight(page);
    if (title === 'Buka rincian saldo di sini') {
      const target = page.locator('[data-tour-active="true"]');
      await target.click();
      await expect(target.locator('..')).toHaveAttribute('open', '');
      await checkSpotlight(page);
      await target.click();
    }
  }
  await page.reload();
  await expect(dialog.getByRole('heading', { name: 'Buka percakapan FLO ini' })).toBeVisible();
  await checkSpotlight(page);
  await dialog.getByRole('button', { name: 'Kembali', exact: true }).click();
  await expect(page).toHaveURL(/persediaan$/);
  await checkSpotlight(page);
  const a11y = await new AxeBuilder({ page }).include('.tour-popover').analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('spotlight-balances.png') });
  await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await dialog.getByRole('button', { name: 'Selesai membaca' }).click();
  await expect(launcher.getByText('Panduan selesai. Buka lagi kapan saja.')).toBeVisible();
  await expect(page.locator('[data-tour-active]')).toHaveCount(0);
  await launcher.getByRole('button', { name: 'Ulangi panduan' }).click();
  await expect(page).toHaveURL(/ringkasan$/);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launcher.getByRole('button', { name: 'Mulai panduan' })).toBeFocused();
  expect(mutations).toEqual([]);
});

test('readable lists support scoped search, status filters, and English labels', async ({ page }, testInfo) => {
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Masuk sebagai Admin Demo', exact: true }).click();
  await expect(page).toHaveURL(/ringkasan/);
  for (const path of ['/donasi', '/pengiriman', '/persediaan', '/pesan', '/pelaporan']) {
    await page.goto(path);
    const list = page.locator('.record-list');
    await expect(list.locator('.record-row').first()).toBeVisible();
    await expect(list).not.toContainText(/state\.|WAREHOUSE_OUTBOUND|RECEIPT_PHOTO|\bNONE\b/);
    await page.getByLabel('Cari di halaman ini').fill('no-such-record-xyz');
    await expect(list.locator('.record-row')).toHaveCount(0);
    await list.getByRole('button', { name: 'Hapus filter' }).click();
    await expect(list.locator('.record-row').first()).toBeVisible();
    const select = list.getByLabel('Status', { exact: true });
    await select.selectOption({ index: 1 });
    const selected = await select.inputValue();
    for (const badge of await list.locator('.record-status').all()) await expect(badge).toHaveText(selected);
    await select.selectOption('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const a11y = await new AxeBuilder({ page }).include('.record-list').analyze();
    expect(a11y.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}.png`) });
  }
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByLabel('Search this page')).toBeVisible();
  const guide = page.getByRole('complementary', { name: 'App guide' });
  await guide.getByRole('button', { name: 'Start walkthrough' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Check the operational clock' })).toBeVisible();
  await checkSpotlight(page);
  await page.screenshot({ path: testInfo.outputPath('walkthrough.png') });
});

test('guide follows role visibility and supports keyboard navigation', async ({ page }) => {
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Masuk sebagai Gudang Demo 1', exact: true }).click();
  await expect(page).toHaveURL(/ringkasan/);
  const allowedPaths = await page.locator('#app-sidebar a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')));
  const launcher = page.getByRole('complementary', { name: 'Panduan aplikasi' });
  const dialog = page.getByRole('dialog');
  await launcher.getByRole('button', { name: 'Mulai panduan' }).focus();
  await page.keyboard.press('Enter');
  await checkSpotlight(page);
  let count = 0;
  while (await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).count()) {
    const previousHeading = await dialog.getByRole('heading').textContent();
    await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading')).not.toHaveText(previousHeading!);
    await checkSpotlight(page);
    expect(allowedPaths).toContain(new URL(page.url()).pathname);
    expect(++count).toBeLessThan(20);
  }
  await expect(dialog.getByRole('button', { name: 'Selesai membaca' })).toBeVisible();
});

test('highlighted controls remain interactive through resizing and detail navigation', async ({ page }, testInfo) => {
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Masuk sebagai Admin Demo', exact: true }).click();
  await expect(page).toHaveURL(/ringkasan/);
  await page.getByRole('button', { name: 'Mulai panduan' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page).toHaveURL(/flo$/);
  await expect(dialog.getByRole('heading', { name: 'Cari organisasi penerima' })).toBeVisible();
  await checkSpotlight(page);
  await dialog.getByRole('button', { name: 'Fokus ke area ini' }).click();
  await expect(page.locator('#f-q')).toBeFocused();
  await page.locator('#f-q').fill('Waru');
  await expect(page.locator('#f-q')).toHaveValue('Waru');
  await page.setViewportSize({ width: 768, height: 900 });
  await checkSpotlight(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await checkSpotlight(page);
  const a11y = await new AxeBuilder({ page }).include('.tour-popover').analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('spotlight-interactive-search.png') });
  await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Buka profil FLO ini' })).toBeVisible();
  await page.locator('[data-tour-active="true"]').click();
  await expect(page).toHaveURL(/\/flo\/[0-9a-f-]+$/);
  await expect(dialog).toHaveCount(0);
  const launcher = page.getByRole('complementary', { name: 'Panduan aplikasi' });
  await expect(launcher.getByText('Panduan dijeda saat Anda menjelajah. Lanjutkan kapan saja.')).toBeVisible();
  await launcher.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page).toHaveURL(/donasi$/);
  await expect(dialog.getByRole('heading', { name: 'Temukan donasi yang ingin diproses' })).toBeVisible();
  await checkSpotlight(page);
});

test('tour explains missing records without pointing to an unrelated control', async ({ page }) => {
  await page.goto('/masuk');
  await page.getByRole('button', { name: 'Masuk sebagai Admin Demo', exact: true }).click();
  await expect(page).toHaveURL(/ringkasan/);
  await page.getByRole('button', { name: 'Mulai panduan' }).click();
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < 4; i++) await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page).toHaveURL(/donasi$/);
  await page.getByLabel('Cari di halaman ini').fill('no-such-record-xyz');
  await expect(page.locator('.record-row')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Buka rincian donasi' })).toBeVisible();
  await expect(dialog).toContainText('Kontrol atau data untuk langkah ini belum tersedia.');
  await expect(page.locator('#main h1')).toHaveAttribute('data-tour-active', 'true');
  await checkSpotlight(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[aria-describedby="tour-description"]')).toHaveCount(0);
});
