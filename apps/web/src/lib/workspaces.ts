import { api } from './api';

/**
 * Opens another workspace you belong to, already signed in: the API creates a session there and hands
 * it over with a one-time link. If that fails (for example the workspace was suspended), the workspace's
 * own sign-in page opens instead.
 */
export async function openWorkspace(slug: string) {
  try {
    const { url } = await api<{ url: string }>(`/workspaces/${encodeURIComponent(slug)}/open`, {
      method: 'POST',
    });
    window.location.assign(url);
  } catch {
    const { protocol, host } = window.location;
    window.location.assign(`${protocol}//${slug}.${host.split('.').slice(1).join('.')}/sign-in`);
  }
}
