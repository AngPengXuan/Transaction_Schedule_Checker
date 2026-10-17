/**
 * Visitor statistics for the deployed site: Google Analytics 4 for unique and
 * returning users, GoatCounter as a lighter cookieless cross-check. Each runs
 * only when its ID is set in `.env.production`, and neither runs under
 * `npm run dev`.
 *
 * Page views are sent by hand rather than automatically, because the app
 * switches pages by URL hash (#/, #/mvcc), which neither tool counts as a new
 * page on its own. `trackPageView` runs once on load and on every hash change.
 */

const GA_ID = import.meta.env.VITE_GA_ID?.trim();
const GOATCOUNTER_CODE = import.meta.env.VITE_GOATCOUNTER_CODE?.trim();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    goatcounter?: { count: (vars: { path: string; title?: string }) => void };
  }
}

let goatcounterReady = false;
let goatcounterPending: string[] = [];

function currentPath(): string {
  return window.location.pathname + window.location.hash;
}

function loadGoogleAnalytics(id: string) {
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  // gtag must push the `arguments` object itself, as Google's snippet does.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  // Page views are sent explicitly in trackPageView, so turn off the automatic one.
  window.gtag('config', id, { send_page_view: false });
}

function loadGoatCounter(code: string) {
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  // Stop the script counting on its own; trackPageView decides what a page is.
  script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  script.addEventListener('load', () => {
    goatcounterReady = true;
    for (const path of goatcounterPending) window.goatcounter?.count({ path });
    goatcounterPending = [];
  });
  document.head.appendChild(script);
}

/** Loads whichever trackers are configured and counts the first page. */
export function initAnalytics() {
  if (!import.meta.env.PROD) return;
  if (GA_ID) loadGoogleAnalytics(GA_ID);
  if (GOATCOUNTER_CODE) loadGoatCounter(GOATCOUNTER_CODE);
  trackPageView();
}

/** Counts the page the URL now shows, hash route included. */
export function trackPageView() {
  if (!import.meta.env.PROD) return;
  const path = currentPath();
  if (GA_ID && window.gtag) {
    window.gtag('event', 'page_view', {
      page_location: window.location.href,
      page_path: path,
      page_title: document.title,
    });
  }
  if (GOATCOUNTER_CODE) {
    if (goatcounterReady) window.goatcounter?.count({ path });
    else goatcounterPending.push(path);
  }
}
