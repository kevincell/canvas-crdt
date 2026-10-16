import { readFileSync } from 'fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

async function person(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(n => localStorage.setItem('crdt-canvas-name', n), name);
  return context.newPage();
}

async function newBoard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /New board/ }).click();
  await expect(page).toHaveURL(/#\/b\/[a-z0-9-]+\?k=/);
  await expect(page.locator('button[aria-label^="Sync status"]')).toBeVisible();
}

async function addNote(page: Page, x: number, y: number, text: string) {
  await page.keyboard.press('n');
  await page.mouse.click(x, y);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

async function saveMergeFile(page: Page): Promise<Buffer> {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Save merge file');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  return readFileSync((await (await download).path())!);
}

async function openFile(page: Page, buffer: Buffer) {
  await page.locator('input[type=file][accept*=".crdtcanvas"]').setInputFiles({ name: 'board.crdtcanvas', mimeType: 'application/octet-stream', buffer });
}

const shapeCount = (page: Page) => page.evaluate(() => (window as any).__crdtCanvas.session.store.getSnapshot().shapes.length as number);
const noteTexts = (page: Page) => page.evaluate(() => (window as any).__crdtCanvas.session.store.getSnapshot().shapes
  .filter((s: any) => s.data.kind === 'note').map((s: any) => s.data.text as string).sort());

test('creates an encrypted board that survives a reload (local-first)', async ({ browser }) => {
  const page = await person(browser, 'Ada');
  await newBoard(page);
  await addNote(page, 400, 300, 'Persist me');
  await page.keyboard.press('r');
  await page.mouse.move(600, 200);
  await page.mouse.down();
  await page.mouse.move(760, 320, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => shapeCount(page)).toBe(2);
  await page.reload();
  await expect.poll(() => noteTexts(page)).toEqual(['Persist me']);
  await expect.poll(() => shapeCount(page)).toBe(2);
});

test('undo and redo work per action', async ({ browser }) => {
  const page = await person(browser, 'Ada');
  await newBoard(page);
  await addNote(page, 400, 300, 'One');
  await expect.poll(() => noteTexts(page)).toEqual(['One']);
  await page.keyboard.press('Control+z');
  await expect.poll(() => noteTexts(page)).not.toEqual(['One']);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => noteTexts(page)).toEqual(['One']);
});

test('command palette finds board content', async ({ browser }) => {
  const page = await person(browser, 'Ada');
  await newBoard(page);
  await addNote(page, 300, 300, 'Quarterly roadmap');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('roadmap');
  await expect(page.getByRole('option', { name: /Quarterly roadmap/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
});

test('two people sync live and see each other', async ({ browser }) => {
  const alice = await person(browser, 'Alice');
  const bob = await person(browser, 'Bob');
  await newBoard(alice);
  await bob.goto(alice.url());
  await expect(bob.locator('button[aria-label^="Sync status"]')).toHaveAttribute('aria-label', /Live/, { timeout: 20_000 });
  await addNote(alice, 400, 300, 'Hello Bob');
  await expect.poll(() => noteTexts(bob), { timeout: 10_000 }).toEqual(['Hello Bob']);
  await addNote(bob, 700, 300, 'Hi Alice');
  await expect.poll(() => noteTexts(alice), { timeout: 10_000 }).toEqual(['Hello Bob', 'Hi Alice']);
  await expect(alice.getByLabel('2 people here')).toBeVisible();
});

test('edits made apart merge, and the returning peer gets a catch-up', async ({ browser }) => {
  const alice = await person(browser, 'Alice');
  const bob = await person(browser, 'Bob');
  await newBoard(alice);
  await bob.goto(alice.url());
  await expect(bob.locator('button[aria-label^="Sync status"]')).toHaveAttribute('aria-label', /Live/, { timeout: 20_000 });
  await bob.locator('button[aria-label^="Sync status"]').click();
  await bob.getByRole('button', { name: /Pause sync/ }).click();
  await addNote(alice, 400, 300, 'Made while Bob was away');
  await addNote(bob, 700, 500, 'Bob offline draft');
  await bob.locator('button[aria-label^="Sync status"]').click();
  await bob.getByRole('button', { name: /Resume sync/ }).click();
  await expect(bob.getByText('While you were offline')).toBeVisible({ timeout: 15_000 });
  const expected = ['Bob offline draft', 'Made while Bob was away'];
  await expect.poll(() => noteTexts(alice), { timeout: 10_000 }).toEqual(expected);
  await expect.poll(() => noteTexts(bob)).toEqual(expected);
});

test('CRDT Lab surfaces a real concurrent conflict that can be resolved', async ({ browser }) => {
  const page = await person(browser, 'Ada');
  await newBoard(page);
  await page.getByRole('button', { name: /CRDT Lab/ }).click();
  await page.getByRole('button', { name: /Divergent moves/ }).click();
  const badge = page.getByRole('button', { name: /^Conflict:/ });
  await expect(badge).toBeVisible();
  await badge.click();
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(badge).toHaveCount(0);
});

test('merge files combine two offline copies without overwriting', async ({ browser }) => {
  const alice = await person(browser, 'Alice');
  await newBoard(alice);
  await addNote(alice, 400, 300, 'Shared start');
  await expect.poll(() => shapeCount(alice)).toBe(1);

  // Alice hands Bob a merge file; no network involved.
  const bob = await person(browser, 'Bob');
  await newBoard(bob);
  await openFile(bob, await saveMergeFile(alice));
  await expect(bob.getByRole('dialog', { name: 'Merge a board file' })).toBeVisible();
  await bob.getByRole('button', { name: 'Merge changes' }).click();
  await expect.poll(() => noteTexts(bob)).toEqual(['Shared start']);

  // Both keep editing apart, then Bob sends his copy back.
  await addNote(alice, 700, 300, 'Alice later');
  await addNote(bob, 700, 500, 'Bob later');
  await openFile(alice, await saveMergeFile(bob));
  await alice.getByRole('button', { name: 'Merge changes' }).click();
  await expect.poll(() => noteTexts(alice)).toEqual(['Alice later', 'Bob later', 'Shared start']);
});
