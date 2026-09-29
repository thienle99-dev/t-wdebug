import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../ui/App';
createRoot(document.getElementById('root')!).render(<StrictMode><App devtoolsTabId={chrome.devtools.inspectedWindow.tabId} /></StrictMode>);
