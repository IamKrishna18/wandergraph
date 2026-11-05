import { useEffect, useState } from 'react';
import { api } from './api';
import { resolvePlacePhoto } from './placeImage';

export interface NodePhoto {
  src: string;
  credit?: string;
}

const cache = new Map<string, Promise<NodePhoto | null>>();

function loads(src: string): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise((done) => {
    const img = new Image();
    const t = setTimeout(() => done(false), 8000);
    img.onload = () => {
      clearTimeout(t);
      done(img.naturalWidth > 1);
    };
    img.onerror = () => {
      clearTimeout(t);
      done(false);
    };
    img.src = src;
  });
}

/** The first photo for a place (graph id "place:xyz" or plain "xyz"), fetched once and shared. */
export function loadPlacePhoto(id: string): Promise<NodePhoto | null> {
  const key = id.replace(/^place:/, '');
  let p = cache.get(key);
  if (!p) {
    p = api
      .place(key)
      // the same rule as the cards: a photo of this exact place, or none
      .then(async (d) => {
        const place = { name: d.place.name, city: d.place.city, photos: d.place.photos, coordinates: d.place.coordinates };
        // the graph loads every place at once, so it doesn't spend a Google search on each
        let ph = await resolvePlacePhoto(place, { noLookup: true });
        // a Google photo that won't load (quota, outage) falls back to Wikipedia / Commons
        if (ph?.kind === 'google' && !(await loads(ph.src))) ph = await resolvePlacePhoto(place, { skipGoogle: true });
        return ph ? { src: ph.src, credit: ph.kind === 'wikipedia' ? 'Wikimedia Commons' : ph.credit } : null;
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
