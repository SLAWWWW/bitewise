import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public landing keeps the pitch readable, loads its assets, and opens the product', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const landing = page.locator('[lang="en"]').filter({ has: page.locator('#landing-main') });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("The coordination layerIndonesia's food banksdon't have yet.");
  for (const id of ['problem', 'how', 'network', 'product', 'roadmap']) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
  await page.locator('#product').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('#product img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.locator('#network').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('#network img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations).toEqual([]);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('landing-hero.png') });
  await expect(landing).toBeVisible();
  await page.getByRole('link', { name: 'See the working system' }).click();
  await expect(page).toHaveURL(/\/masuk(?:\?|$)/);
  expect(errors).toEqual([]);
});

test('workflow explains each step with pointer and keyboard input', async ({ page }) => {
  await page.goto('/');
  const safety = page.getByRole('tab', { name: /Safety floor/ });
  await safety.click();
  await expect(safety).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('A deterministic floor scores every submission');
  await safety.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Fair matching/ })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Each branch is scored on real proximity');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /Closed loop/ })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('every donation ends in a recorded, auditable outcome');
  await page.keyboard.press('Home');
  await expect(safety).toBeFocused();
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
});

test('navigation and layout work on narrow screens, tablets and wide screens', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const width of [320, 768, 1512]) {
    await page.setViewportSize({ width, height: 860 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const toggle = page.getByRole('button', { name: 'Open navigation' });
    if (width < 900) {
      await toggle.click();
      const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
      await expect(nav).toBeVisible();
      await nav.getByRole('link', { name: 'Network', exact: true }).click();
      await expect(page).toHaveURL(/#network$/);
      await expect(nav).toBeHidden();
      await toggle.click();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(nav).toBeHidden();
    } else {
      await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Product', exact: true }).click();
      await expect(page).toHaveURL(/#product$/);
    }
    await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`) });
    const card = page.getByTestId('pipeline-preview');
    await card.scrollIntoViewIfNeeded();
    const bounds = await card.boundingBox();
    for (const child of [card.getByRole('heading'), card.getByText('Explore the pipeline'), card.locator('img')]) {
      const box = await child.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
    }
  }
});

test('workflow moves between nodes and pauses for manual exploration', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const workflow = page.getByTestId('workflow-preview');
  await workflow.scrollIntoViewIfNeeded();
  await expect(workflow).toHaveAttribute('data-motion', 'running');
  await expect(page.getByTestId('workflow-packet')).toBeAttached();
  const initial = await page.getByRole('tab', { selected: true }).getAttribute('id');
  await page.clock.fastForward(3600);
  await expect(page.getByRole('tab', { selected: true })).not.toHaveAttribute('id', initial!);
  await page.getByRole('button', { name: 'Pause workflow animation' }).click();
  const paused = await page.getByRole('tab', { selected: true }).getAttribute('id');
  await page.clock.fastForward(12000);
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', paused!);
  await expect(page.getByTestId('workflow-packet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play workflow animation' }).click();
  await page.clock.fastForward(3600);
  await expect(page.getByRole('tab', { selected: true })).not.toHaveAttribute('id', paused!);
  await expect(page.getByRole('button', { name: 'Pause workflow animation' })).toBeFocused();
  await page.getByRole('tab', { name: /Fair matching/ }).focus();
  await expect(workflow).toHaveAttribute('data-motion', 'paused');
});

test('reduced motion stays still until played and offscreen animation sleeps', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const workflow = page.getByTestId('workflow-preview');
  await workflow.scrollIntoViewIfNeeded();
  await expect(workflow).toHaveAttribute('data-motion', 'paused');
  await expect(page.getByTestId('workflow-packet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play workflow animation' }).click();
  await expect(workflow).toHaveAttribute('data-motion', 'running');
  await expect(page.getByTestId('workflow-packet')).not.toHaveCSS('animation-name', 'none');
  const globe = page.getByTestId('revolving-globe');
  await globe.scrollIntoViewIfNeeded();
  await expect(globe).toHaveAttribute('data-ready', 'true');
  await expect(globe).toHaveAttribute('data-motion', 'paused');
  await expect(workflow).toHaveAttribute('data-motion', 'paused');
  await page.getByRole('button', { name: 'Play globe rotation' }).click();
  await expect(globe).toHaveAttribute('data-motion', 'running');
  await page.locator('#roadmap').scrollIntoViewIfNeeded();
  await expect(globe).toHaveAttribute('data-motion', 'paused');
});

test('globe visibly revolves and freezes when paused', async ({ page }, testInfo) => {
  await page.goto('/');
  const globe = page.getByTestId('revolving-globe');
  await globe.scrollIntoViewIfNeeded();
  await expect(globe).toHaveAttribute('data-ready', 'true');
  await expect(globe).toHaveAttribute('data-motion', 'running');
  // Capture the visible scene: the sphere canvas intentionally extends past the phone viewport.
  const before = await globe.screenshot({ path: testInfo.outputPath('globe-before.png'), scale: 'css' });
  await expect.poll(async () => (await globe.screenshot({ scale: 'css' })).equals(before)).toBe(false);
  await page.getByRole('button', { name: 'Pause globe rotation' }).click();
  await expect(globe).toHaveAttribute('data-motion', 'paused');
  const paused = await globe.screenshot({ path: testInfo.outputPath('globe-paused-before.png'), scale: 'css' });
  // Compare separate rendered frames, allowing enough time for an accidental loop to move.
  await page.waitForTimeout(600);
  expect((await globe.screenshot({ path: testInfo.outputPath('globe-paused.png'), scale: 'css' })).equals(paused)).toBe(true);
});

test('globe keeps an illustration when WebGL is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (String(args[0]).startsWith('webgl')) return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto('/');
  const globe = page.getByTestId('revolving-globe');
  await globe.scrollIntoViewIfNeeded();
  await expect(globe.locator('button')).toHaveCount(0);
  await expect(globe.locator('img')).toHaveCSS('opacity', '1');
  await expect.poll(() => globe.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(globe).toHaveAttribute('data-motion', 'paused');
});
