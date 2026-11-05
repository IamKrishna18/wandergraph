import { useEffect, useState } from 'react';
import { api, photoUrl } from './api';

export interface NodePhoto {
  src: string;
  credit?: string;
}

const cache = new Map<string, Promise<NodePhoto | null>>();

/** The first photo for a place (graph id "place:xyz" or plain "xyz"), fetched once and shared. */
export function loadPlacePhoto(id: string): Promise<NodePhoto | null> {
  const key = id.replace(/^place:/, '');
  let p = cache.get(key);
  if (!p) {
    p = api
      .place(key)
      .then((d) => {
        const ph = d.place.photos?.[0];
        const src = photoUrl(ph?.proxy_url);
        return src ? { src, credit: ph?.attributions?.[0]?.display_name } : null;
      })
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}

/** Photos for a set of places, loaded a few at a time so the graph stays responsive. */
export function usePlacePhotos(ids: string[]): Record<string, NodePhoto | null> {
  const [photos, setPhotos] = useState<Record<string, NodePhoto | null>>({});
  const key = ids.join('|');
  useEffect(() => {
    let live = true;
    const queue = [...ids];
    const worker = async () => {
      while (live && queue.length) {
        const id = queue.shift()!;
        const ph = await loadPlacePhoto(id);
        if (live) setPhotos((m) => (id in m ? m : { ...m, [id]: ph }));
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => {
      live = false;
    };
    // ids are captured through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return photos;
}
