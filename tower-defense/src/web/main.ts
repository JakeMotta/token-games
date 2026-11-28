// Ink Tower Defense as a catalog game (docs/first-game-walkthrough.md): the same page as the built-in app
// (../game/app.ts), built by shell/scripts/build-web.mjs into catalog/, where the shell's page is the hosted adapter.
// Imports run in order, so the adapter knows the game's settings before the game mounts.
import './configure';
import '../game/app';
