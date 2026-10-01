// Where a directory browser message is, kept outside the message itself.
//
// The browser used to keep its state only in the embed footer. When the embed is hidden (a user can
// remove embeds from a message) the footer is gone, the state fell back to the home directory, and
// Session Start opened sessions there while the dropdown still listed a project's folders.
// Each render now stores its state under a short key that rides on every component custom id
// ("a4d:dir:start~<key>"), and the store is a file so keys survive bot restarts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config.js';

export interface BrowserState {
  path: string;
  page: number;
  mode?: 'browse' | 'resume';
  selectedSessionId?: string;
}

const STORE = path.join(CONFIG_DIR, 'browser-state.json');
const MAX_ENTRIES = 500;
const SEP = '~';

let cache: Record<string, BrowserState> | null = null;

function load(): Record<string, BrowserState> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(STORE, 'utf-8')) as Record<string, BrowserState>;
  } catch {
    cache = {};
  }
  return cache;
}

/** Store a state and return its key. Same state, same key. */
export function saveBrowserState(state: BrowserState): string {
  const key = crypto.createHash('sha1').update(JSON.stringify(state)).digest('hex').slice(0, 12);
  const store = load();
  if (!store[key]) {
    store[key] = state;
    const keys = Object.keys(store);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete store[old];
    try {
      fs.mkdirSync(path.dirname(STORE), { recursive: true });
      fs.writeFileSync(STORE, JSON.stringify(store));
    } catch (err) {
      console.warn('[browser] Failed to persist browser state:', err);
    }
  }
  return key;
}

export function loadBrowserState(key: string | undefined): BrowserState | null {
  if (!key) return null;
  return load()[key] ?? null;
}

export function withStateKey(customId: string, key: string): string {
  return `${customId}${SEP}${key}`;
}

/** "a4d:dir:start~abc" -> { base: "a4d:dir:start", key: "abc" } */
export function splitStateKey(customId: string): { base: string; key?: string } {
  const i = customId.lastIndexOf(SEP);
  return i === -1 ? { base: customId } : { base: customId.slice(0, i), key: customId.slice(i + 1) };
}
