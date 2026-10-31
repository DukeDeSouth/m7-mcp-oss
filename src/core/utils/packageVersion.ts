import { readFileSync } from 'fs';

/**
 * Version of this package, read from its own package.json (both src/ and dist/
 * builds of this file sit three directories below it). Single source for
 * serverInfo, the m7://status resource and telemetry.
 */
export const PACKAGE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
