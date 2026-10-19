import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APIS } from '../src/apis.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

/** Converts a Chrome match pattern into a regular expression (scheme://host/path, with * wildcards in the path). */
function matchPattern(pattern) {
  const m = pattern.match(/^(https):\/\/([a-z0-9.-]+)(\/.*)$/);
  if (!m) throw new Error(`Not a valid match pattern: ${pattern}`);
  return new RegExp(`^${m[1]}://${m[2].replace(/\./g, '\\.')}${m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

const sourceFiles = ['background.js', 'popup.js', 'popup.html', ...fs.readdirSync(path.join(root, 'src')).map((f) => `src/${f}`)];

describe('manifest', () => {
  it('is Manifest V3 with the least permissions that work', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(['alarms', 'storage']);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });

  it('asks for the three API paths and nothing else (no wildcard hosts)', () => {
    expect(manifest.host_permissions).toHaveLength(3);
    for (const pattern of manifest.host_permissions) {
      expect(() => matchPattern(pattern)).not.toThrow();
      expect(pattern).not.toMatch(/^\*|\/\/\*|<all_urls>|http:\/\//);
    }
  });

  it('every URL the code fetches is covered by a host permission, and every permission is used', () => {
    const patterns = manifest.host_permissions.map(matchPattern);
    for (const api of APIS) expect(patterns.some((re) => re.test(api.url)), api.url).toBe(true);
    for (const re of patterns) expect(APIS.some((api) => re.test(api.url))).toBe(true);
  });

  it('points to files that exist, and the icons are PNGs of the declared sizes', () => {
    const files = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)];
    for (const f of files) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    for (const [size, f] of Object.entries(manifest.icons)) {
      const png = fs.readFileSync(path.join(root, f));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16)).toBe(Number(size));
    }
  });
});

describe('source code', () => {
  it('never turns network text into HTML and never evaluates strings as code', () => {
    for (const f of sourceFiles.filter((f) => f.endsWith('.js'))) {
      expect(read(f), f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
    }
  });
  it('does not poll (no setInterval) and does not call third-party sites for connectivity', () => {
    for (const f of sourceFiles) {
      expect(read(f), f).not.toMatch(/setInterval/);
      expect(read(f), f).not.toMatch(/google\.com/);
    }
  });
  it('only the fetcher talks to the network', () => {
    for (const f of sourceFiles.filter((f) => f.endsWith('.js') && f !== 'src/fetcher.js')) expect(read(f), f).not.toMatch(/\bfetch\(/);
  });
});
