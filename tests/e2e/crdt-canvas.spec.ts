import { test, expect } from '@playwright/test';

test.describe('CRDT Canvas - Join Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#crdt-name', { timeout: 10000 });
  });

  test('shows join screen with title and inputs', async ({ page }) => {
    await expect(page.locator('#crdt-name')).toBeVisible();
    await expect(page.locator('#crdt-room')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join Room' })).toBeVisible();
    await expect(page.locator('text=CRDT Canvas')).toBeVisible();
  });

  test('allows typing name and room', async ({ page }) => {
    await page.locator('#crdt-name').fill('TestUser');
    await page.locator('#crdt-room').fill('test-room-123');
    await expect(page.locator('#crdt-name')).toHaveValue('TestUser');
    await expect(page.locator('#crdt-room')).toHaveValue('test-room-123');
  });

  test('join button is enabled after filling both fields', async ({ page }) => {
    await page.locator('#crdt-name').fill('Alice');
    await expect(page.getByRole('button', { name: 'Join Room' })).toBeDisabled();
    await page.locator('#crdt-room').fill('room-1');
    await expect(page.getByRole('button', { name: 'Join Room' })).toBeEnabled();
  });
});

test.describe('CRDT Canvas - Canvas Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#crdt-name', { timeout: 10000 });
    await page.locator('#crdt-name').fill('TestUser');
    await page.locator('#crdt-room').fill('test-room-123');
    await page.getByRole('button', { name: 'Join Room' }).click();
    await page.waitForTimeout(800);
  });

  test('toolbar has all tool buttons', async ({ page }) => {
    const tools = ['Select (V)', 'Draw (S)', 'Rectangle (R)', 'Ellipse (E)',
      'Line (L)', 'Text (T)', 'Upload Image (I)', 'Sticky Note (N)', 'Eraser (X)'];
    for (const tool of tools) {
      await expect(page.getByTitle(tool)).toBeVisible();
    }
  });

  test('toolbar has undo/redo/zoom buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redo (Ctrl+Y)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();
  });

  test('chat toggle opens chat panel', async ({ page }) => {
    await page.getByTitle('Toggle chat').click();
    await expect(page.locator('text=/Chat/')).toBeVisible();
    await expect(page.locator('input[placeholder="Type a message…"]')).toBeVisible();
  });

  test('can send a chat message', async ({ page }) => {
    await page.getByTitle('Toggle chat').click();
    await page.locator('input[placeholder="Type a message…"]').fill('Hello world!');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('text=Hello world!')).toBeVisible();
  });

  test('simulator toggle opens partition simulator', async ({ page }) => {
    await page.getByTitle(/partition simulator/).click();
    await expect(page.locator('text=Partition Simulator')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Network Split' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Offline Edit' })).toBeVisible();
  });

  test('tool hint shows current tool and zoom', async ({ page }) => {
    // Check the canvas area has the tool hint (positioned top-left with "stroke · 100%")
    await expect(page.locator('text=Stroke')).toBeVisible();
  });
});

test.describe('CRDT Canvas - Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#crdt-name', { timeout: 10000 });
    await page.locator('#crdt-name').fill('TestUser');
    await page.locator('#crdt-room').fill('test-room-123');
    await page.getByRole('button', { name: 'Join Room' }).click();
    await page.waitForTimeout(800);
  });

  test('pressing ? shows keyboard shortcuts overlay', async ({ page }) => {
    await page.locator('canvas').click();
    await page.keyboard.press('?');
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible();
    await expect(page.locator('text=Select tool')).toBeVisible();
    await expect(page.locator('text=Sticky Note')).toBeVisible();
    await expect(page.locator('text=Upload Image')).toBeVisible();
  });

  test('closing shortcuts with Escape', async ({ page }) => {
    await page.locator('canvas').click();
    await page.keyboard.press('?');
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Keyboard Shortcuts')).not.toBeVisible();
  });
});

test.describe('CRDT Canvas - Offline Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#crdt-name', { timeout: 10000 });
    await page.locator('#crdt-name').fill('TestUser');
    await page.locator('#crdt-room').fill('test-room-123');
    await page.getByRole('button', { name: 'Join Room' }).click();
    await page.waitForTimeout(800);
  });

  test('offline mode shows queued edits indicator', async ({ page }) => {
    await page.getByTitle(/partition simulator/).click();
    await page.getByRole('button', { name: 'Offline Edit' }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText('✏️ Offline — edits queued')).toBeVisible();
  });
});

test.describe('CRDT Canvas - Two Peers Real-Time Collaboration', () => {
  test('Alice and Bob connect in same room, sync drawing, and show awareness', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    page1.on('console', msg => console.log('[P1]', msg.text()));
    page2.on('console', msg => console.log('[P2]', msg.text()));

    const roomId = 'demo-' + Math.random().toString(36).slice(2, 8);

    // Tab 1: Alice joins
    await page1.goto('/');
    await page1.waitForSelector('#crdt-name');
    await page1.locator('#crdt-name').fill('Alice');
    await page1.locator('#crdt-room').fill(roomId);
    await page1.getByRole('button', { name: 'Join Room' }).click();
    await page1.waitForTimeout(500);

    // Tab 2: Bob joins same room
    await page2.goto('/');
    await page2.waitForSelector('#crdt-name');
    await page2.locator('#crdt-name').fill('Bob');
    await page2.locator('#crdt-room').fill(roomId);
    await page2.getByRole('button', { name: 'Join Room' }).click();

    // Verify peers connected
    await expect(page1.getByText(/peer connected/i)).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText(/peer connected/i)).toBeVisible({ timeout: 10000 });

    // Alice sends a chat message
    await page1.getByTitle('Toggle chat').click();
    await page1.locator('input[placeholder="Type a message…"]').fill('Hey Bob!');
    await page1.getByRole('button', { name: 'Send' }).click();

    // Bob sees Alice's message in chat
    await page2.getByTitle('Toggle chat').click();
    await expect(page2.locator('text=Hey Bob!')).toBeVisible({ timeout: 5000 });

    // Alice draws a rectangle
    await page1.getByRole('button', { name: 'Rectangle (R)' }).click();
    const canvas1 = page1.locator('canvas');
    const box1 = await canvas1.boundingBox();
    if (box1) {
      await page1.mouse.move(box1.x + 100, box1.y + 100);
      await page1.mouse.down();
      await page1.mouse.move(box1.x + 250, box1.y + 200);
      await page1.mouse.up();
    }

    // Both peers see 1 shape on canvas
    await expect(page1.getByText(/1 shapes/i)).toBeVisible({ timeout: 5000 });
    await expect(page2.getByText(/1 shapes/i)).toBeVisible({ timeout: 5000 });

    await page1.screenshot({ path: '/home/kevin/.gemini/antigravity-ide/brain/e1dc9bc1-f895-44c1-9733-af1b3d723b62/demo_screenshot.png' });

    await context1.close();
    await context2.close();
  });
});
