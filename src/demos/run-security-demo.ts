#!/usr/bin/env node
/**
 * CLI entrypoint for the security E2E smoke demo.
 *
 * Usage:
 *   npm run demo:security
 *   CHROMA_URL=http://localhost:8000 npm run demo:security
 *   DOGE_DEMO_IMAGE=alpine:3.14 npm run demo:security
 */

import { SecurityDemo } from './security-demo.js';

async function main(): Promise<void> {
  const demo = new SecurityDemo({
    image: process.env.DOGE_DEMO_IMAGE ?? 'alpine:3.14',
    reportPath: process.env.DOGE_DEMO_REPORT ?? undefined,
  });
  const result = await demo.run();
  console.log(`\nReport written to: ${result.reportPath}`);
  console.log(
    `Stages: ${result.stages.map((s) => `${s.name}=${s.ok ? 'ok' : 'warn'}`).join(' ')}`,
  );
  if (!result.ok) {
    console.log(
      'One or more stages recorded warnings. See the report for details.',
    );
  }
}

main().catch((err) => {
  console.error('security-demo failed:', err);
  process.exit(1);
});
