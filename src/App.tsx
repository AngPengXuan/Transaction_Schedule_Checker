import { useEffect, useState } from 'react';
import { trackPageView } from './analytics';
import { pageForHash, TABS } from './pages/registry';
import './App.css';

/**
 * The shell: title, one tab per page, and whichever page the URL hash names.
 * Hash routes (#/, #/mvcc) need no server support, so they work as-is on
 * GitHub Pages.
 */
function App() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
      trackPageView();
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const page = pageForHash(hash);
  const Page = page.component;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Schedule Checker</h1>
        <nav className="tabs" aria-label="Pages">
          {TABS.map((p) =>
            p.component ? (
              <a
                key={p.hash}
                href={`#/${p.hash}`}
                className={`tab ${p === page ? 'active' : ''}`}
                aria-current={p === page ? 'page' : undefined}
                title={p.blurb}
              >
                {p.title}
              </a>
            ) : (
              <span key={p.hash} className="tab soon" title={`${p.blurb} — coming soon`}>
                {p.title}
                <span className="soon-tag">soon</span>
              </span>
            ),
          )}
        </nav>
      </header>

      {Page && <Page />}
    </div>
  );
}

export default App;
