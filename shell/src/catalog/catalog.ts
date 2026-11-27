// The catalog on this computer: which games are installed, which one is active, the signed index last fetched, and
// the install and remove requests waiting for the player. It has no Electron in it, so it is tested with plain node;
// catalog-host.ts puts it in the app, and the control socket (control.ts) lets the CLI and agents talk to it.
//
// The one rule everything here keeps: nothing is installed, updated or removed until the player approves it in the
// app. An agent or the CLI can only ask (request), and the request waits in the app with its permission sheet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkBundleDir } from './bundle';
import { cleanGamesDir, fetchBytes, installPrepared, InstallError, prepareBundle, type Prepared } from './installer';
import { approvedHostsFor, permissionSheet, type SheetLine } from './permissions';
import { blockedBy, checkIndex, isNewer, type CatalogIndex, type IndexGame, type RegistryTier, type Tier } from './registry';
import { verify } from './signing';
import { compareVersions, isGameId, SHELL_VERSION, type GameManifest } from '../manifest';

export interface InstalledGame { name: string; version: string; tier: RegistryTier; sha256: string; source: string; network: string[]; installedAt: string; blocked?: string }
export interface LocalGame { id: string; name: string; version: string; dir: string; network: string[]; addedAt: string }
export interface CatalogState {
  stateVersion: 1;
  installed: Record<string, InstalledGame>;
  local: LocalGame[];
  active: Record<string, string>; // per host app: the game it shows
  allowCommunity: boolean; // off by default: community games are listed only when the player turns this on
}

export interface BuiltIn { id: string; name: string; description: string; version: string }

export interface GameRow {
  id: string; name: string; description: string; version: string; tier: Tier;
  installed: boolean; active: boolean; network: string[];
  update?: string; // a newer version in the catalog
  blocked?: string; // why it may not run
}

export type RequestAction = 'install' | 'update' | 'remove' | 'add-local';
export interface PendingRequest {
  requestId: string; action: RequestAction; id: string; name: string; version: string; tier: Tier;
  from: 'player' | 'agent'; sheet: SheetLine[]; network: string[]; createdAt: string;
}

export interface CatalogOptions {
  dir: string; // the catalog folder (games/, saves/, state.json, cache/)
  hostApp: string; // the app hosting games (its built-in game's id)
  builtIn: BuiltIn;
  trustedKeys: readonly string[]; // ed25519 public keys for the index (keys.ts)
  registryUrl: string;
  afterSwap?: () => void; // tests only: see installer.ts
}

export const MAX_PENDING = 5;

type Internal = PendingRequest & { prepared?: Prepared; dir?: string; prev?: InstalledGame };

export class Catalog {
  readonly gamesDir: string;
  readonly savesDir: string;
  private readonly statePath: string;
  private readonly cacheDir: string;
  private st: CatalogState;
  private idx: CatalogIndex | null = null;
  private idxError = '';
  private idxFetchedAt = '';
  private pending: Internal[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly o: CatalogOptions) {
    this.gamesDir = path.join(o.dir, 'games');
    this.savesDir = path.join(o.dir, 'saves');
    this.statePath = path.join(o.dir, 'state.json');
    this.cacheDir = path.join(o.dir, 'cache');
    fs.mkdirSync(this.gamesDir, { recursive: true });
    cleanGamesDir(this.gamesDir);
    this.st = this.loadState();
    this.loadCachedIndex();
  }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private changed(): void { for (const cb of this.listeners) { try { cb(); } catch { /* a listener's problem is not ours */ } } }

  // ---- state ----

  private loadState(): CatalogState {
    const s: CatalogState = { stateVersion: 1, installed: {}, local: [], active: {}, allowCommunity: false };
    let raw: Record<string, unknown> | null = null;
    try { raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch { /* first run */ }
    if (!raw || typeof raw !== 'object') return s;
    if (raw.installed && typeof raw.installed === 'object') {
      for (const [id, g] of Object.entries(raw.installed as Record<string, InstalledGame>))
        if (isGameId(id) && g && typeof g.version === 'string' && fs.existsSync(path.join(this.gamesDir, id, 'game.json'))) s.installed[id] = g;
    }
    if (Array.isArray(raw.local)) s.local = (raw.local as LocalGame[]).filter((g) => g && isGameId(g.id) && typeof g.dir === 'string');
    if (raw.active && typeof raw.active === 'object') for (const [k, v] of Object.entries(raw.active as Record<string, unknown>)) if (isGameId(k) && isGameId(v)) s.active[k] = v;
    s.allowCommunity = raw.allowCommunity === true;
    return s;
  }

  private saveState(): void {
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.st, null, 2) + '\n');
    fs.renameSync(tmp, this.statePath);
  }

  get allowCommunity(): boolean { return this.st.allowCommunity; }
  setAllowCommunity(on: boolean): void { this.st.allowCommunity = !!on; this.saveState(); this.changed(); }

  // ---- the signed index ----

  private loadCachedIndex(): void {
    try {
      const bytes = fs.readFileSync(path.join(this.cacheDir, 'index.json'));
      const sig = fs.readFileSync(path.join(this.cacheDir, 'index.json.sig'), 'utf8');
      this.acceptIndex(bytes, sig);
      this.idxFetchedAt = fs.statSync(path.join(this.cacheDir, 'index.json')).mtime.toISOString();
    } catch { /* no cache, or it no longer verifies */ }
  }

  // Verifies and parses an index; throws when the signature or the format is wrong.
  private acceptIndex(bytes: Buffer, sig: string): CatalogIndex {
    if (!this.o.trustedKeys.length) throw new InstallError('this build has no catalog signing key yet, so it cannot trust any catalog');
    if (!verify(bytes, sig, this.o.trustedKeys)) throw new InstallError('the catalog signature is not valid: it was changed or not signed by the catalog key');
    let raw: unknown;
    try { raw = JSON.parse(bytes.toString('utf8')); } catch { throw new InstallError('the catalog is not valid JSON'); }
    const c = checkIndex(raw);
    if (!c.ok) throw new InstallError(`the catalog is malformed: ${c.errors.slice(0, 3).join('; ')}`);
    this.idx = c.index;
    this.applyBlocklist();
    return c.index;
  }

  // Fetches the index and its signature. Only ever called when the player (or an agent) asks for the catalog.
  async refresh(): Promise<{ ok: boolean; error?: string; games: number }> {
    try {
      const bytes = await fetchBytes(this.o.registryUrl, undefined, 2 * 1024 * 1024);
      const sig = (await fetchBytes(this.o.registryUrl + '.sig', undefined, 4096)).toString('utf8');
      const index = this.acceptIndex(bytes, sig);
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(path.join(this.cacheDir, 'index.json'), bytes);
      fs.writeFileSync(path.join(this.cacheDir, 'index.json.sig'), sig);
      this.idxError = '';
      this.idxFetchedAt = new Date().toISOString();
      this.changed();
      return { ok: true, games: index.games.length };
    } catch (e) {
      this.idxError = (e as Error).message;
      this.changed();
      return { ok: false, error: this.idxError, games: 0 };
    }
  }

  // An installed game that the blocklist now names is switched off (not deleted; the player can remove it).
  private applyBlocklist(): void {
    if (!this.idx) return;
    let any = false;
    for (const [id, g] of Object.entries(this.st.installed)) {
      const b = blockedBy(this.idx.blocklist, id, g.version, g.sha256);
      const why = b ? b.reason : undefined;
      if (g.blocked !== why) { g.blocked = why; any = true; if (!why) delete g.blocked; }
      if (why && this.active() === id) { delete this.st.active[this.o.hostApp]; any = true; }
    }
    if (any) this.saveState();
  }

  private listed(id: string): IndexGame | undefined {
    const g = this.idx?.games.find((x) => x.id === id);
    if (!g) return undefined;
    if (g.tier === 'community' && !this.st.allowCommunity) return undefined;
    return g;
  }

  // ---- what the player sees ----

  active(): string {
    const id = this.st.active[this.o.hostApp];
    if (!id || id === this.o.builtIn.id) return this.o.builtIn.id;
    if (this.st.installed[id] && !this.st.installed[id].blocked) return id;
    if (this.st.local.some((g) => g.id === id)) return id;
    return this.o.builtIn.id;
  }

  list(): GameRow[] {
    const act = this.active(), b = this.o.builtIn;
    const rows: GameRow[] = [{ id: b.id, name: b.name, description: b.description, version: b.version, tier: 'built-in', installed: true, active: act === b.id, network: [] }];
    for (const [id, g] of Object.entries(this.st.installed)) {
      const next = this.idx?.games.find((x) => x.id === id);
      const row: GameRow = { id, name: g.name, description: next?.description || '', version: g.version, tier: g.tier, installed: true, active: act === id, network: g.network };
      if (next && isNewer(next.version, g.version) && compareVersions(next.minShellVersion, SHELL_VERSION) <= 0) row.update = next.version;
      if (g.blocked) row.blocked = g.blocked;
      rows.push(row);
    }
    for (const g of this.st.local) rows.push({ id: g.id, name: g.name, description: g.dir, version: g.version, tier: 'local', installed: true, active: act === g.id, network: g.network });
    for (const g of this.idx?.games || []) {
      if (rows.some((r) => r.id === g.id)) continue;
      if (g.tier === 'community' && !this.st.allowCommunity) continue;
      const row: GameRow = { id: g.id, name: g.name, description: g.description, version: g.version, tier: g.tier, installed: false, active: false, network: g.network };
      const bl = blockedBy(this.idx!.blocklist, g.id, g.version, g.bundle.sha256);
      if (bl) row.blocked = bl.reason;
      else if (compareVersions(g.minShellVersion, SHELL_VERSION) > 0) row.blocked = `needs a newer Token Games (shell ${g.minShellVersion})`;
      rows.push(row);
    }
    return rows;
  }

  status() {
    return {
      hostApp: this.o.hostApp, active: this.active(), allowCommunity: this.st.allowCommunity,
      catalog: { url: this.o.registryUrl, fetchedAt: this.idxFetchedAt || null, games: this.idx?.games.length ?? 0, error: this.idxError || null, signed: !!this.idx },
      games: this.list(), pending: this.requests(),
    };
  }

  requests(): PendingRequest[] { return this.pending.map(({ prepared: _p, dir: _d, prev: _v, ...r }) => r); }

  // Where a game's files are, for the host to serve; null for the built-in game and unknown ids.
  gameDir(id: string): string | null {
    if (this.st.installed[id] && !this.st.installed[id].blocked) return path.join(this.gamesDir, id);
    return this.st.local.find((g) => g.id === id)?.dir ?? null;
  }
  approvedHosts(id: string): string[] { return this.st.installed[id]?.network || this.st.local.find((g) => g.id === id)?.network || []; }
  saveDir(id: string): string { return path.join(this.savesDir, id); }

  manifestOf(id: string): GameManifest | null {
    const dir = this.gameDir(id);
    if (!dir) return null;
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8')); } catch { return null; }
  }

  // ---- changes that need no approval ----

  setActive(id: string): string {
    if (id !== this.o.builtIn.id) {
      if (this.st.installed[id]?.blocked) throw new InstallError(`${id} is blocked: ${this.st.installed[id].blocked}`);
      if (!this.gameDir(id)) throw new InstallError(`${id} is not installed`);
    }
    if (this.active() === id) return id;
    if (id === this.o.builtIn.id) delete this.st.active[this.o.hostApp]; else this.st.active[this.o.hostApp] = id;
    this.saveState();
    this.changed();
    return id;
  }

  // ---- changes the player approves ----

  // Asks for an install, update, removal or a local folder. Returns the request the app shows; nothing changes yet.
  async request(action: RequestAction, idOrDir: string, from: 'player' | 'agent' = 'player'): Promise<PendingRequest> {
    const same = this.pending.find((r) => r.action === action && (r.id === idOrDir || r.dir === idOrDir));
    if (same) return this.requests().find((r) => r.requestId === same.requestId)!;
    if (this.pending.length >= MAX_PENDING) throw new InstallError(`there are already ${MAX_PENDING} requests waiting for the player`);
    const base = { requestId: crypto.randomUUID(), action, from, createdAt: new Date().toISOString() };
    let r: Internal;
    if (action === 'install' || action === 'update') {
      if (!isGameId(idOrDir)) throw new InstallError('not a game id');
      if (idOrDir === this.o.builtIn.id || this.st.local.some((g) => g.id === idOrDir)) throw new InstallError(`${idOrDir} is not a catalog game`);
      if (!this.idx) throw new InstallError(this.idxError || 'the catalog has not been loaded; check for games first');
      const g = this.listed(idOrDir);
      if (!g) throw new InstallError(`${idOrDir} is not in the catalog${this.idx.games.some((x) => x.id === idOrDir) ? ' (community games are off; turn them on in Settings)' : ''}`);
      if (compareVersions(g.minShellVersion, SHELL_VERSION) > 0) throw new InstallError(`${g.id} needs shell ${g.minShellVersion}; this is ${SHELL_VERSION}`);
      const prev = this.st.installed[g.id];
      if (prev && !isNewer(g.version, prev.version)) throw new InstallError(`${g.id} ${prev.version} is installed and the catalog has ${g.version}: nothing newer to install`);
      const bytes = await fetchBytes(g.bundle.url, this.o.registryUrl);
      const prepared = prepareBundle(bytes, { id: g.id, version: g.version, sha256: g.bundle.sha256 }, this.idx.blocklist);
      if (JSON.stringify(prepared.manifest.network || []) !== JSON.stringify(g.network)) throw new InstallError('the bundle asks for different network hosts than the catalog lists');
      const m = prepared.manifest;
      r = { ...base, action: prev ? 'update' : 'install', id: g.id, name: m.name, version: m.version, tier: g.tier, network: approvedHostsFor(m), sheet: permissionSheet(m, g.tier, prev ? { version: prev.version, network: prev.network } : undefined), prepared, prev };
    } else if (action === 'remove') {
      const inst = this.st.installed[idOrDir], loc = this.st.local.find((g) => g.id === idOrDir);
      if (!inst && !loc) throw new InstallError(idOrDir === this.o.builtIn.id ? `${idOrDir} is built in and cannot be removed` : `${idOrDir} is not installed`);
      const name = inst?.name || loc!.name;
      r = { ...base, id: idOrDir, name, version: inst?.version || loc!.version, tier: inst ? inst.tier : 'local', network: [], sheet: [{ kind: 'warn', text: `Removes ${name} from this computer. Its save is kept, so reinstalling picks up where it left off.` }] };
    } else {
      const dir = path.resolve(idOrDir);
      const c = checkBundleDir(dir);
      if (!c.ok || !c.manifest) throw new InstallError(`that folder is not a web game: ${c.errors.join('; ')}`);
      const m = c.manifest;
      if (m.id === this.o.builtIn.id || this.st.installed[m.id]) throw new InstallError(`a game called ${m.id} is already installed`);
      r = { ...base, id: m.id, name: m.name, version: m.version, tier: 'local', network: approvedHostsFor(m), sheet: permissionSheet(m, 'local'), dir };
    }
    this.pending.push(r);
    this.changed();
    return this.requests().find((x) => x.requestId === r.requestId)!;
  }

  deny(requestId: string): boolean {
    const n = this.pending.length;
    this.pending = this.pending.filter((r) => r.requestId !== requestId);
    if (this.pending.length !== n) this.changed();
    return this.pending.length !== n;
  }

  // The player said yes in the app. Only the app's own UI calls this; the control socket has no way to.
  approve(requestId: string): GameRow[] {
    const r = this.pending.find((x) => x.requestId === requestId);
    if (!r) throw new InstallError('that request is no longer waiting');
    this.pending = this.pending.filter((x) => x !== r);
    try {
      if (r.action === 'install' || r.action === 'update') {
        const p = r.prepared!;
        installPrepared(this.gamesDir, p, { installedVersion: this.st.installed[r.id]?.version, afterSwap: this.o.afterSwap });
        const g = this.listed(r.id)!;
        this.st.installed[r.id] = { name: p.manifest.name, version: p.manifest.version, tier: g.tier, sha256: p.sha256, source: g.bundle.url, network: r.network, installedAt: new Date().toISOString() };
      } else if (r.action === 'remove') {
        if (this.st.installed[r.id]) {
          fs.rmSync(path.join(this.gamesDir, r.id), { recursive: true, force: true });
          delete this.st.installed[r.id];
        }
        this.st.local = this.st.local.filter((g) => g.id !== r.id);
        if (this.st.active[this.o.hostApp] === r.id) delete this.st.active[this.o.hostApp];
      } else {
        this.st.local = this.st.local.filter((g) => g.id !== r.id);
        this.st.local.push({ id: r.id, name: r.name, version: r.version, dir: r.dir!, network: r.network, addedAt: new Date().toISOString() });
      }
      this.saveState();
    } finally {
      this.changed();
    }
    return this.list();
  }
}
