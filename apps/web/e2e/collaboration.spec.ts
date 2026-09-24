import { expect, test, type Page } from '@playwright/test';

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`;

async function signup(page: Page, name: string, next?: string) {
  await page.goto(next ? `/signup?next=${encodeURIComponent(next)}` : '/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(`${name.toLowerCase()}${unique()}@e2e.dev`);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign up' }).click();
}

/** Visible editor text (Monaco renders spaces as NBSP). */
async function editorText(page: Page): Promise<string> {
  const text = await page.locator('[data-testid="editor"] .view-lines').innerText();
  return text.replace(/\u00a0/g, ' ');
}

async function typeAtEnd(page: Page, text: string) {
  await page.locator('[data-testid="editor"] .view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  // Real key presses: Monaco auto-closes brackets/quotes and then "types over" them.
  await page.keyboard.type(text);
}

test('two users edit the same file in real time and both see the run output', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  // Alice signs up and creates a room.
  await signup(alice, 'Alice');
  await expect(alice).toHaveURL(/\/dashboard/);
  await alice.getByLabel('Room name').fill('E2E pairing');
  await alice.getByRole('button', { name: 'Create room' }).click();
  await expect(alice).toHaveURL(/\/room\//);
  await expect.poll(() => editorText(alice)).toContain('Hello from CodeSync');
  const roomPath = new URL(alice.url()).pathname;

  // Bob opens the invite link, signs up, and lands in the room as an editor.
  await signup(bob, 'Bob', roomPath);
  await expect(bob).toHaveURL(new RegExp(roomPath));
  await expect.poll(() => editorText(bob)).toContain('Hello from CodeSync');

  // Both appear in presence.
  await expect(alice.getByLabel('2 online')).toBeVisible();

  // Alice types; Bob sees it (CRDT sync over the Yjs WebSocket).
  await typeAtEnd(alice, 'print("typed by Alice")');
  await expect.poll(() => editorText(bob)).toContain('print("typed by Alice")');

  // Bob sees Alice's labelled remote cursor.
  await expect(bob.locator('.yRemoteSelectionHead').first()).toBeAttached();

  // Bob runs the code; output reaches everyone in the room.
  await bob.getByTestId('run-button').click();
  for (const page of [alice, bob]) {
    await expect(page.getByTestId('run-status')).toHaveText('Success', { timeout: 20_000 });
    await expect(page.getByTestId('stdout')).toHaveText('Hello from CodeSync!\ntyped by Alice');
  }
  await expect(alice.getByTestId('output-panel')).toContainText('by Bob');

  // History tab lists the run.
  await alice.getByRole('tab', { name: 'history' }).click();
  await expect(alice.getByTestId('history-panel')).toContainText('Bob');
  await alice.getByRole('tab', { name: 'output' }).click();

  if (process.env.E2E_SCREENSHOT) {
    await alice.screenshot({ path: process.env.E2E_SCREENSHOT });
  }
});

test('an infinite loop times out after ~5 seconds', async ({ page }) => {
  await signup(page, 'Tim');
  await page.getByLabel('Room name').fill('Timeout');
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect.poll(() => editorText(page)).toContain('Hello from CodeSync');
  await typeAtEnd(page, 'while True: pass');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-status')).toHaveText('Timeout', { timeout: 20_000 });
  await expect(page.getByTestId('stderr')).toContainText('time limit');
});
