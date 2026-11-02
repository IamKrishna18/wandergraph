import '@testing-library/jest-dom/vitest';

// jsdom gaps
Element.prototype.scrollIntoView = function () {};
window.scrollTo = (() => {}) as typeof window.scrollTo;
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
