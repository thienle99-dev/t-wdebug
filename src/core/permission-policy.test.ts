import { describe, expect, it } from 'vitest';
import manifest from '../../manifest.json';
import builtManifest from '../../public/manifest.json';

describe('persistent website access policy', () => {
  it('grants stable HTTP and HTTPS host access without optional per-domain grants', () => {
    expect(builtManifest).toEqual(manifest);
    expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect('optional_host_permissions' in manifest).toBe(false);
    expect(manifest.permissions).not.toContain('debugger');
  });

  it('loads only lightweight bridges at document start on supported frames', () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0]).toMatchObject({
      matches: ['http://*/*', 'https://*/*'],
      js: ['capture/hook-bridge.js', 'capture/ui-inspector.js'],
      run_at: 'document_start',
      all_frames: true,
    });
  });

  it('keeps activeTab only for the explicitly invoked screenshot capability', () => {
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).not.toContain('tabs');
  });
});
