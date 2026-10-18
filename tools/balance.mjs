// Compatibility CLI: all new measurements use canonical starts and the fixed protocol.
import { main } from '../skills/game-production/scripts/balance-audit.mjs';
main(['run', ...process.argv.slice(2)]).catch((e) => {
  console.error('BALANCE_AUDIT_BLOCKED: ' + e.message);
  process.exitCode = 1;
});
