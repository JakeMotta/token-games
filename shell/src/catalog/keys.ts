// The public keys the app trusts to sign the catalog index (raw ed25519, base64). The private half of each lives only
// in Jake's macOS Keychain (service token-games-registry-signing-key); the index is signed on his Mac with
// `tg-registry sign --keychain` and committed, never in CI. How it was made, backed up and rotated:
// docs/first-game-walkthrough.md, "The signing key". To rotate, add the new key here beside the old one, ship that
// app, sign with the new key, and only then drop the old one.
export const REGISTRY_KEYS: readonly string[] = [
  'Fswexp3LDILw4Chds9pjXqg/YziOv9duTD5iLzOy1aY=', // account "registry", made 2026-11-27
];

// Where the app fetches the catalog from, on demand only (never at launch). The repo is public; GitHub Pages serves
// registry/ from it.
export const DEFAULT_REGISTRY = 'https://jakemotta.github.io/token-games/registry/index.json';
