// The `tokengames` command (cli.ts does the work).
import { runCli, socketCall } from './cli';

runCli(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), call: socketCall() }).then((code) => { process.exitCode = code; });
