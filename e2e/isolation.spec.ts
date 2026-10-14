import { expect, test } from '@playwright/test';
import { apiCall, rand, signInAsOwner, signInWithPassword } from './helpers';

/** Someone signed in to one workspace tries every door into another workspace's work. */
test('another workspace’s items, files and live stream stay closed', async ({ page, browser }) => {
  test.setTimeout(120_000);
  // Globex creates a space, an item with an attachment, from its own address.
  const gx = await browser.newContext({ baseURL: 'http://globex.localhost:3000' });
  const g = await gx.newPage();
  await signInWithPassword(g, 'owner@globex.test');
  const key = `X${rand(2).toUpperCase()}`;
  const space = (await apiCall(g, 'POST', '/spaces', { key, name: 'Secret' })).json;
  const item = (await apiCall(g, 'POST', `/spaces/${key}/items`, { type: 'task', title: 'Globex only' })).json;
  const fileUrl = await g.evaluate(async (id) => {
    const form = new FormData();
    form.append('file', new Blob(['private notes'], { type: 'text/plain' }), 'notes.txt');
    const res = await fetch(`/api/v1/items/${id}/attachments`, { method: 'POST', body: form });
    return ((await res.json()) as { url: string }).url;
  }, item.id);
  expect(await g.evaluate(async (u) => (await fetch(u)).status, fileUrl)).toBe(200);
  await gx.close();

  // Acme's owner tries the key, the ids, the file link and the stream.
  await signInAsOwner(page);
  await page.goto(`/spaces/${key}/items/${key}-1`);
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  for (const path of [`/items/${item.id}`, `/items/${key}-1`, `/spaces/${space.id}/board`, `/items/${item.id}/comments`, `/items/${item.id}/attachments`]) {
    expect((await apiCall(page, 'GET', path)).status, path).toBe(404);
  }
  // The browser resolves *.localhost itself, so these requests are made from the page.
  const status = (u: string) => page.evaluate(async (url) => (await fetch(url)).status, u);
  expect(await status(fileUrl)).toBe(404);
  expect(await status(`/api/v1/spaces/${space.id}/events`)).toBe(404);
  const search = (await apiCall(page, 'GET', '/search?q=Globex%20only')).json.items as unknown[];
  expect(search).toEqual([]);
});
