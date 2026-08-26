import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { adoptRapierChamber } from './lib/solver';
import './index.css';

// The Rapier chamber spike, behind a URL flag while it is being measured
// against the classic solver — see RESEARCH.md, phase 6. Asked for and not
// granted (the WASM failed to load), the classic solver simply stays.
if (new URLSearchParams(window.location.search).get('solver') === 'rapier') {
  void adoptRapierChamber().then((adopted) => {
    console.info(adopted ? 'chamber: rapier solver active' : 'chamber: rapier failed to load');
  });
}

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
