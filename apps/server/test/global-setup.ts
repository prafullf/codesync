import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Apply migrations to the dedicated test database once before all test files. */
export default function setup(): void {
  const dbPkg = path.resolve(import.meta.dirname, '../../../packages/db');
  const require = createRequire(path.join(dbPkg, 'package.json'));
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: dbPkg,
    env: { ...process.env },
    stdio: 'pipe',
  });
}
