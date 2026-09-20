import { test, expect, type Page } from '@playwright/test';

/** Pin the locale so the assertions do not depend on the browser's language. */
async function openApp(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('eqscope.locale', 'ru');
    localStorage.setItem('eqscope.theme', 'dark');
  });
  await page.goto('/');
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('the RTA screen loads and captures from the microphone', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);

  const start = page.getByRole('button', { name: 'Старт' });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();

  // Chromium's fake capture device plays a tone, so a level has to appear.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = document.body.innerText.match(/(-?\d+\.\d)\s+отн\. дБ/);
          return m ? Number(m[1]) : -200;
        }),
      { timeout: 15000 },
    )
    .toBeGreaterThan(-100);

  // And the accumulated-time readout has to move.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = document.body.innerText.match(/накоплено (\d+) с/);
          return m ? Number(m[1]) : 0;
        }),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('every screen renders', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);

  for (const name of ['Водопад', 'Резонансы', 'Снимки', 'Настройки', 'Диагностика', 'Спектр']) {
    await page.getByRole('button', { name }).click();
    await expect(page.locator('.app__body')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('a snapshot survives a round trip through IndexedDB', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);

  await page.getByRole('button', { name: 'Старт' }).click();
  await expect(page.getByRole('button', { name: 'Стоп' })).toBeVisible();

  await page.getByRole('button', { name: 'Снимки' }).click();
  await page.getByPlaceholder('Название').fill('Проверка');
  await page.getByRole('button', { name: 'Сохранить снимок' }).click();
  await expect(page.getByText('Проверка')).toBeVisible();

  // Reload: the snapshot has to come back from storage, not from React state.
  await page.reload();
  await page.getByRole('button', { name: 'Снимки' }).click();
  await expect(page.getByText('Проверка')).toBeVisible();

  expect(errors).toEqual([]);
});
