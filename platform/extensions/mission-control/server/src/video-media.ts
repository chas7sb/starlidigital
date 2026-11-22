import type { Store } from './store.js';
import type { Context } from './security.js';

/** Private media is addressed through records, never through caller-supplied paths. */
export function authorizedVideoMedia(store: Store, context: Context, filename: string): string | undefined {
  const user = context.user;
  if (!user || user.disabled || (context.operatorTokenId && !context.operatorPermissions?.includes('READ'))) return;
  let media: ReturnType<Store['get']>;
  let filePath: string | undefined;
  if (/^preview-prev-[a-f0-9-]+\.png$/.test(filename)) {
    media = store.get('video-previews', filename.slice(8, -4));
    filePath = media?.outputPath;
  } else if (/^vrnd-[a-f0-9-]+(?:-thumb\.jpg|\.mp4)$/.test(filename)) {
    const thumb = filename.endsWith('-thumb.jpg');
    media = store.get('video-renders', filename.slice(0, thumb ? -10 : -4));
    if (media?.status === 'COMPLETE') filePath = thumb ? media.thumbnailPath : media.outputPath;
  } else if (/^vast-[a-f0-9-]+\.wav$/.test(filename)) {
    media = store.get('asset-records', filename.slice(0, -4));
    filePath = media?.storagePath;
  }
  if (!media || !filePath || (user.role !== 'ADMIN' && media.ownerId !== user.id)) return;
  return filePath;
}
