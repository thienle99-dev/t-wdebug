import { DevToolsNetworkCaptureAdapter } from '../core/capture/devtools-network';

const captureAdapter = new DevToolsNetworkCaptureAdapter();
void captureAdapter.start().catch(() => undefined);
window.addEventListener('beforeunload', () => { void captureAdapter.stop(); }, { once: true });

chrome.devtools.panels.create('Debug Lens', 'icons/icon32.png', 'panel.html');
