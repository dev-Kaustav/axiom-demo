import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = ['Exposure', 'Portfolio', 'Scenarios', 'Relationships', 'Trade', 'Contracts', 'Data'];

/** Fails the test on any uncaught page error, so a broken view cannot pass quietly. */
async function guard(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => expect(errors).toEqual([]);
}

test('the five questions can be answered end to end', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/');

  // 1. What am I exposed to?
  await expect(page.getByRole('heading', { name: 'What am I exposed to?' })).toBeVisible();
  await expect(page.locator('.summary-strip').getByText('Worst outcome')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Economic drivers' })).toBeVisible();

  // The October and December decisions must be the dominant drivers of a book
  // built on them. This is computed, so it is a real assertion about the model.
  await expect(page.getByText('October FOMC decision')).toBeVisible();
  await expect(page.getByText('December FOMC decision')).toBeVisible();

  // 2. What happens under this outcome?
  await page.getByRole('button', { name: 'Scenarios' }).click();
  await expect(page.getByRole('heading', { name: 'What happens under this outcome?' })).toBeVisible();

  const scenarioTable = page.locator('table.scenario-table');
  await expect(scenarioTable).toBeVisible();
  const rowCount = await scenarioTable.locator('tbody tr').count();
  expect(rowCount).toBeGreaterThan(20);

  // Sorting is real: worst-first then best-first must change the leading row.
  const firstRow = () => scenarioTable.locator('tbody tr').first().locator('th').innerText();
  const worstFirst = await firstRow();
  await page.getByRole('button', { name: 'Profit and loss' }).click();
  const bestFirst = await firstRow();
  expect(worstFirst).not.toEqual(bestFirst);

  // Selecting a row drives the linked panel: the positions that produced it.
  await scenarioTable.locator('tbody tr').first().locator('th button').click();
  await expect(page.locator('.scenario-detail .contribution-list button').first()).toBeVisible();

  // 3. Where does the hedge fail?
  await page.getByRole('button', { name: 'Relationships' }).click();
  await expect(page.getByRole('heading', { name: /where does the hedge fail/i })).toBeVisible();

  // The ranked pairs are computed from payoffs, and selecting one traces it
  // through the graph into the evidence inspector.
  await page.locator('.hedge-watch button').first().click();
  const evidence = page.locator('.evidence-panel');
  await expect(evidence.getByRole('heading', { name: 'Where it fails' })).toBeVisible();
  await expect(evidence.getByRole('heading', { name: 'Why the contracts differ' })).toBeVisible();

  // 4. The audit trail: the settlement rule as the venue published it.
  await evidence.locator('.clause-card .instrument-link').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Settlement rule, as published' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Economic predicate' })).toBeVisible();
  await expect(dialog.getByText(/federal funds/i).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 5. What happens if I make this trade?
  await page.getByRole('button', { name: 'Trade', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What happens if I make this trade?' })).toBeVisible();
  // The book as it stands is on screen before anything is simulated; only the
  // after column is empty.
  const worstRow = page.locator('table.compare-table tbody tr').first();
  await expect(worstRow.locator('th')).toHaveText('Worst outcome');
  await expect(worstRow.locator('td').nth(1)).toHaveText('\u2014');

  await page.getByLabel('Quantity').fill('200000');
  await page.getByLabel('Price').fill('0.02');
  await page.getByRole('button', { name: 'Simulate trade' }).click();
  await expect(worstRow.locator('td').nth(1)).not.toHaveText('\u2014');
  await expect(worstRow.locator('td').nth(2)).not.toHaveText('\u2014');

  noErrors();
});

test('nothing is silently excluded', async ({ page }) => {
  await page.goto('/');

  // Contracts the model declines to interpret are listed, not dropped. The
  // groups start folded, so each one states its own coverage before it is
  // opened -- and opening it shows every contract behind that count.
  await page.getByRole('button', { name: 'Contracts' }).click();
  await page.getByLabel('Scope').selectOption('DECOY');
  const groupRows = page.locator('.group-row');
  await expect(groupRows.first()).toBeVisible();
  await expect(page.locator('.master-table tbody tr:not(.group-row)')).toHaveCount(0);
  await expect(groupRows.first()).toContainText('withheld');

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('.master-table tbody tr:not(.group-row)').first()).toBeVisible();
  await expect(page.getByText('withheld').nth(1)).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.locator('.master-table tbody tr:not(.group-row)')).toHaveCount(0);

  // Search narrows, and an empty result says so rather than showing nothing.
  await page.getByLabel('Scope').selectOption('ALL');
  await page.getByLabel('Search contracts').fill('zzzznotacontract');
  await expect(page.getByText('No contract matches that search.')).toBeVisible();

  // Provenance: anchors carry the evidence that established them.
  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByRole('heading', { name: 'Established facts' })).toBeVisible();
  await expect(page.getByText('RESOLVED MARKET').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Model assumptions' })).toBeVisible();

  // The two causes of an unreachable outcome are never merged.
  await expect(page.getByRole('heading', { name: /Already settled/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Outside the declared move alphabet/ })).toBeVisible();
});

test('the workspace can be resized, panned and compared', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/#/relationships');

  // Side rails are draggable: a contract name too long for the default width
  // has to be readable, not truncated.
  const railWidth = () => page.locator('.relationship-rail').evaluate((e) => e.clientWidth);
  const before = await railWidth();
  const handle = page.locator('.resize-handle').first();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 123, box.y + 200, { steps: 8 });
  await page.mouse.up();
  expect(await railWidth()).toBeGreaterThan(before);

  // And by keyboard, for anyone not using a pointer.
  const evidenceWidth = () => page.locator('.evidence-panel').evaluate((e) => e.clientWidth);
  const evidenceBefore = await evidenceWidth();
  await page.locator('.resize-handle').nth(1).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  expect(await evidenceWidth()).toBeGreaterThan(evidenceBefore);

  // The canvas pans under the pointer. It is a transform, not a scroll
  // container, which is what lets a container sit at a negative coordinate.
  const viewport = page.locator('.graph-viewport');
  const stage = page.locator('.graph-stage');
  const beforePan = await stage.evaluate((e) => getComputedStyle(e).transform);
  const canvas = (await viewport.boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width - 40, canvas.y + canvas.height - 40);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 80, canvas.y + 60, { steps: 10 });
  await page.mouse.up();
  expect(await stage.evaluate((e) => getComputedStyle(e).transform)).not.toEqual(beforePan);

  // Shift-click a second contract: the relation between the two is computed,
  // and its absence would be stated rather than left blank.
  await page.getByLabel('Fit graph').click(); // pan left the nodes off-screen
  await page.locator('.contract-node').nth(0).click();
  await page.locator('.contract-node').nth(2).click({ modifiers: ['Shift'] });
  const evidencePanel = page.locator('.evidence-panel');
  await expect(evidencePanel.locator('.badge').first()).toHaveText(/2 CONTRACTS/);
  await expect(evidencePanel.getByText(/RELATION|NO COMPUTED RELATION/).first()).toBeVisible();
  await expect(evidencePanel.getByRole('heading', { name: 'Why the contracts differ' })).toBeVisible();

  noErrors();
});

test('a selection of contracts is measured against the outcome space', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/#/relationships');
  const evidence = page.locator('.evidence-panel');

  // Nothing selected: the inspector describes the whole book, not a blank.
  await expect(evidence.locator('.badge').first()).toHaveText('WHOLE BOOK');
  await expect(evidence.getByRole('heading', { name: 'Model scope' })).toBeVisible();

  // The five October brackets partition the October decision, so exactly one
  // pays in every world and the combined payout is a constant. That is the
  // whole point of the basket check, and it is computed, not asserted.
  for (const [i, name] of ['Oct -50+', 'Oct -25', 'Oct hold', 'Oct +25', 'Oct +50+'].entries()) {
    await page.locator('.contract-node', { hasText: name }).first()
      .click(i === 0 ? {} : { modifiers: ['Shift'] });
  }
  await expect(evidence.locator('.badge').first()).toHaveText('PARTITION · 5 CONTRACTS');
  await expect(evidence.getByText(/Exactly one of these 5 contracts pays in every modelled world/)).toBeVisible();
  await expect(evidence.getByText('$100,000 in every world')).toBeVisible();

  // The rail narrows to the pairs that touch the selection.
  await expect(page.getByText(/Pairs touching the 5 contracts in focus/)).toBeVisible();

  // A click on bare canvas clears it and hands back the whole-book view.
  const canvas = (await page.locator('.graph-viewport').boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width - 30, canvas.y + canvas.height - 30);
  await expect(evidence.locator('.badge').first()).toHaveText('WHOLE BOOK');

  noErrors();
});

test('graph containers drag like a flowchart', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/#/relationships');
  await expect(page.locator('.graph-cluster').first()).toBeVisible();

  // Containers are draggable like a flowchart, and their contracts travel
  // with them rather than being left behind.
  const clusterAt = () => page.locator('.graph-cluster').first().evaluate((e) => [e.offsetLeft, e.offsetTop]);
  await expect(page.locator('.graph-cluster').first()).toBeVisible();
  const [left0, top0] = await clusterAt();
  const head = page.locator('.graph-cluster').first().locator('.cluster-head');
  const headBox = (await head.boundingBox())!;
  await page.mouse.move(headBox.x + 40, headBox.y + headBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headBox.x + 240, headBox.y + headBox.height / 2 + 150, { steps: 10 });
  await page.mouse.up();
  const [left1, top1] = await clusterAt();
  expect(left1).toBeGreaterThan(left0);
  expect(top1).toBeGreaterThan(top0);
  await expect(page.locator('.graph-cluster').first().locator('.contract-node').first()).toBeVisible();

  // Snap lines every container up on the grid; auto-arrange puts them back.
  await page.getByLabel('Snap containers to grid').click();
  const snapped = await clusterAt();
  expect(snapped[0] % 16).toBe(0);
  expect(snapped[1] % 16).toBe(0);
  await page.getByLabel('Auto-arrange containers').click();
  expect(await clusterAt()).toEqual([left0, top0]);

  // Collapsing a container is still a click, not a drag.
  await page.locator('.graph-cluster').first().locator('.cluster-fold').click();
  await expect(page.locator('.graph-cluster').first().locator('.contract-node')).toHaveCount(0);

  noErrors();
});

test('no horizontal scroll at any desktop width', async ({ page }) => {
  // Desktop-only by decision: .app declares min-width 1200px. Narrower
  // viewports are a later pass, not a supported width today.
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    for (const name of PAGES) {
      await page.getByRole('button', { name, exact: true }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${name} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
});

test('accessibility: zero violations on every screen and in the modal', async ({ page }) => {
  await page.goto('/');

  for (const name of PAGES) {
    await page.getByRole('button', { name, exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations, `violations on ${name}`).toEqual([]);
  }

  // And with a dialog open, which is its own focus context.
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await page.locator('.instrument-link').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const modalResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(modalResults.violations, 'violations in the modal').toEqual([]);
});

test('focus returns to the opener when the dialog closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('button', { name: 'Expand all' }).click();
  const opener = page.locator('.instrument-link').first();
  const label = await opener.innerText();
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(label);
});

test('the whole universe can be put on the canvas', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/#/relationships');

  // Relations are drawn without a selection: which relations exist is the
  // filter's job, and selection only decides what is emphasised.
  await expect(page.locator('.contract-node')).toHaveCount(17);
  await expect(page.locator('.graph-edge').first()).toBeAttached();

  // Every held contract was interpreted, so nothing in the book is inert.
  await expect(page.locator('.contract-node.inert')).toHaveCount(0);

  // The toggle puts the entire universe on the canvas, including the contracts
  // no relation can be computed about. They are carried with the reason.
  await page.getByRole('button', { name: 'All contracts' }).click();
  await expect(page.locator('.contract-node')).toHaveCount(122);
  await expect(page.locator('.contract-node.inert')).toHaveCount(57);
  await expect(page.getByText(/65 carry a payoff vector/)).toBeVisible();
  await expect(page.locator('.graph-bottom')).toContainText('122 nodes');

  // Contracts group on a chosen dimension, like the positions navigator.
  const groupBy = page.getByLabel('Group contracts by');
  await groupBy.selectOption('Status');
  await expect(page.locator('.graph-cluster')).toHaveCount(4);
  await groupBy.selectOption('Event');
  await expect(page.locator('.graph-cluster')).toHaveCount(18);
  await groupBy.selectOption('Venue');
  await expect(page.locator('.graph-cluster')).toHaveCount(1);

  noErrors();
});

test('a selection may include contracts the model never interpreted', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/#/relationships');
  await page.getByRole('button', { name: 'All contracts' }).click();
  // Narrowed so the pair under test is on screen: the October decision brackets
  // are interpreted, and the October dissent contracts are refused.
  await page.getByLabel('Search graph contracts').fill('october');
  await page.getByLabel('Group contracts by').selectOption('Status');

  const evidence = page.locator('.evidence-panel');

  // An inert node states why it carries no edge rather than leaving it blank.
  await page.locator('.contract-node.inert').first().click();
  await expect(evidence.locator('.badge').first()).toHaveText('NO PREDICATE');

  // Pairing it with an interpreted contract says what cannot be derived,
  // instead of reporting an independence that was never checked.
  await page.locator('.contract-node:not(.inert)').first().click({ modifiers: ['Shift'] });
  await expect(evidence.getByText('NOT COMPUTABLE').first()).toBeVisible();
  await expect(evidence.getByText(/Not a function of the modelled rate path/).first()).toBeVisible();

  noErrors();
});

test('a trackpad pinch zooms the canvas continuously', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/#/relationships');
  const stage = page.locator('.graph-stage');
  const scale = async () =>
    Number((await stage.evaluate((e) => getComputedStyle(e).transform)).match(/matrix\(([-\d.]+)/)![1]);

  // A pinch reaches the page as a wheel event carrying ctrlKey, many of them
  // per gesture. Each has to move the zoom in proportion to its own delta.
  const pinch = (times: number) =>
    page.locator('.graph-viewport').evaluate((node, n) => {
      for (let i = 0; i < n; i += 1) {
        node.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
      }
    }, times);

  const before = await scale();
  await pinch(1);
  const once = await scale();
  expect(once).toBeGreaterThan(before);

  // Four more events in the same frame move it about four times as far. A fixed
  // step per event, or one that read a stale zoom, would not compound.
  await pinch(4);
  const zoomed = await scale();
  expect(zoomed - once).toBeGreaterThan((once - before) * 3);

  // The gesture is refused everywhere in the app, so a pinch never zooms the
  // browser page out from under a fixed desktop layout -- and a pinch outside
  // the canvas does not move the canvas either.
  for (const sel of ['.evidence-panel', '.relationship-rail', 'body']) {
    const prevented = await page.locator(sel).first().evaluate((node) => {
      const e = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true });
      node.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented, sel).toBe(true);
  }
  expect(await scale()).toBe(zoomed);

  noErrors();
});

test('dragging a container keeps its wires attached and curved', async ({ page }) => {
  const noErrors = await guard(page);
  await page.goto('/#/relationships');
  await page.getByRole('button', { name: 'All contracts' }).click();
  await expect(page.locator('.contract-node')).toHaveCount(122);

  const paths = () => page.locator('.graph-lines .graph-edge > path:not(.edge-hit)')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''));
  const before = await paths();
  expect(before.length).toBeGreaterThan(1000);

  const head = (await page.locator('.graph-cluster').first().locator('.cluster-head').boundingBox())!;
  await page.mouse.move(head.x + 40, head.y + 8);
  await page.mouse.down();
  await page.mouse.move(head.x + 200, head.y + 140, { steps: 6 });

  // Mid-drag the wires are still drawn, still curved, and the ones attached to
  // this container have followed it. Only the decoration is dropped: a dashed
  // stroke and an arrowhead each cost several times a plain one to rasterise,
  // and the layer repaints on every frame a wire moves.
  const during = await paths();
  expect(during.length).toBe(before.length);
  expect(during.every((d) => d.includes('C'))).toBe(true);
  expect(during.filter((d, i) => d !== before[i]).length).toBeGreaterThan(0);
  await expect(page.locator('.graph-lines')).toHaveClass(/simplified/);
  await expect(page.locator('.graph-edge').first()).toBeVisible();

  await page.mouse.up();
  await expect(page.locator('.graph-lines')).not.toHaveClass(/simplified/);
  const after = await paths();
  expect(after.every((d) => d.includes('C'))).toBe(true);

  noErrors();
});
