import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke, convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock('./hudIpc', () => ({ dragOut: vi.fn() }));
beforeEach(() => { vi.resetModules(); mock.invoke.mockReset(); });
it('shares Home prefetch with Library and paints the complete snapshot', async () => {
  const rows = Array.from({ length: 70 }, (_, id) => ({ id, thumb_path: `thumb-${id}.png` }));
  mock.invoke.mockResolvedValue(rows);
  const { listCaptures, captureSnapshot } = await import('./captures');
  const [home, library] = await Promise.all([listCaptures(10), listCaptures()]);
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  expect(home).toHaveLength(10);
  expect(library).toHaveLength(70);
  expect(captureSnapshot()).toBe(library);
  expect(captureSnapshot(10)).toEqual(home);
  expect(home[0].thumb_url).toBe('asset:thumb-0.png');
});
it('keeps the last successful snapshot after a failed refresh and allows retry', async () => {
  mock.invoke.mockResolvedValueOnce([{ id: 1, thumb_path: null }]).mockRejectedValueOnce(new Error('busy')).mockResolvedValueOnce([]);
  const { listCaptures, captureSnapshot } = await import('./captures');
  await listCaptures();
  await expect(listCaptures()).rejects.toThrow('busy');
  expect(captureSnapshot()).toHaveLength(1);
  await listCaptures();
  expect(captureSnapshot()).toEqual([]);
});
