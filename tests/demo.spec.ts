import { test, expect } from '@playwright/test';

test('portfolio, inspectors, scenario recalculation and proposed trade', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Portfolio exposure' })).toBeVisible();
  await expect(page.getByText('$276,150', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/portfolio-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Inspect Another Fed rate hike in 2026', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Canonical claim' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: /Scheduled path → Another hike/ }).click();
  await expect(page.getByText('Deterministically verified', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/relationship-inspector.png', fullPage: true });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Explore the difference' }).click();
  await expect(page.getByRole('heading', { name: 'Scenario Lab', exact: true })).toBeVisible();
  await expect(page.getByText('−$26,150', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: /Emergency hike before October/ }).uncheck();
  await expect(page.getByText('−$186,150', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /After the window closes/ }).click();
  await expect(page.getByText('−$86,150', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Include trade' }).check();
  await expect(page.getByText('−$129,150', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/scenario-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('instrument filters, empty state, graph edges, downloads and walkthrough', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Instruments', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search instruments', exact: true }).fill('another');
  await expect(page.locator('.master-table tbody tr')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search instruments', exact: true }).fill('nonexistent');
  await expect(page.getByText('No matching instruments')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('combobox', { name: 'Filter family' }).selectOption('fam_fed_hike_count_2026');
  await expect(page.locator('.master-table tbody tr')).toHaveCount(5);
  await page.getByRole('button', { name: 'Relationships', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect IMPLIES ¬1: con_another_hike_implies_not_count1' }).click();
  await expect(page.getByText('The reverse fails', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load the counterexample' }).click();
  await expect(page.getByText('−$86,150', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Market universe & portfolio' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('axiom-fed-snapshot.json');
  await page.getByRole('button', { name: 'Walkthrough' }).click();
  for (let n = 0; n < 3; n++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('.tour-banner')).not.toBeVisible();
});

for (const width of [375, 768, 1024, 1440]) {
  test(`responsive layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    for (const tab of ['Portfolio', 'Scenario', 'Relationships', 'Instruments', 'Data']) {
      await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), tab).toBe(true);
    }
    if (width === 375) {
      await page.getByRole('navigation').getByRole('button', { name: 'Portfolio', exact: true }).click();
      await page.screenshot({ path: 'test-results/portfolio-mobile.png', fullPage: true });
    }
  });
}

test('accessible screens, modal focus and panel controls', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.goto('/');
  for (const tab of ['Portfolio', 'Scenario', 'Relationships', 'Instruments', 'Data']) {
    await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  await page.getByRole('switch', { name: 'Structural relationship graph' }).uncheck();
  await page.getByRole('switch', { name: 'Structural checks' }).uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Structural relationships', exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Structural checks', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Inspect Another Fed rate hike in 2026', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Inspect Another Fed rate hike in 2026', exact: true })).toBeFocused();
});
