// The public keys the app trusts to sign the catalog index (raw ed25519, base64). Empty until the production key is
// made: until then no index verifies, so the app lists no Verified games and installs only local bundles and
// community games (when the player turns those on). How to make the key and who holds it: docs/catalog.md.
export const REGISTRY_KEYS: readonly string[] = [];

// Where the app fetches the catalog from, on demand only (never at launch). The repo is public; GitHub Pages serves
// registry/ from it.
export const DEFAULT_REGISTRY = 'https://jakemotta.github.io/token-games/registry/index.json';
