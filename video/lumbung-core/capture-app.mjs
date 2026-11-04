import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('./assets/', import.meta.url));
await mkdir(assets, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1512, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:3000/masuk');
  await page.getByRole('button', { name: /Koordinator Demo 1/ }).click();
  await page.waitForURL('**/ringkasan');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  for (const [route, name, selector] of [
    ['/donasi/baru', 'intake-screen', '.direct-page'],
    ['/flo', 'network-screen', '#main'],
    ['/pelaporan', 'evidence-screen', '.direct-page'],
    ['/ringkasan', 'dashboard-screen', '#main'],
  ]) {
    await page.goto(`http://localhost:3000${route}`);
    await page.evaluate(() => document.fonts.ready);
    const content = page.locator(selector);
    if (name === 'intake-screen') {
      await page.getByLabel(/Quantity \(portion\)/).fill('10');
      // Fill the visible example only. Never submit a donation during capture.
    }
    const buffer = await content.screenshot();
    const info = await sharp(buffer).metadata();
    await sharp(buffer).extract({left:0,top:0,width:info.width,height:Math.min(info.height,1000)}).png().toFile(`${assets}/${name}.png`);
    console.log(name, info.width, Math.min(info.height, 1000));
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
