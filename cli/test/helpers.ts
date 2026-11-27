// A real catalog behind a real control socket, the way the app runs them, with a throwaway signed registry
// (shell/test/catalog-fixtures.ts: the key pair lives only in memory).
import { Catalog } from '@token-games/shell/catalog/catalog';
import { catalogCommands } from '@token-games/shell/catalog/commands';
import { serveControl, type ControlServer } from '@token-games/shell/catalog/control';
import { testRegistry, tmpDir } from '../../shell/test/catalog-fixtures';

export interface Running { catalog: Catalog; dir: string; server: ControlServer; close(): Promise<void> }

export async function runningApp(): Promise<Running> {
  const reg = testRegistry([{}]);
  const dir = tmpDir('cli');
  const catalog = new Catalog({
    dir, hostApp: 'ant-farm', builtIn: { id: 'ant-farm', name: 'Ant Farm', description: 'Ants.', version: '1.0.0' },
    trustedKeys: [reg.publicKey], registryUrl: reg.url,
  });
  const server = await serveControl(dir, catalogCommands(catalog));
  return { catalog, dir, server, close: () => server.close() };
}

export function capture() {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}
