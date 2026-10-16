// Run only with the user present. record.mjs asks for immediate capture consent.
import { spawn } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const folder = resolve(process.argv[2] ?? join(root, 'captures', `acceptance-${new Date().toISOString().replaceAll(':', '-')}`));
const fixture = spawn(join(root, '.build/debug/walkthrough-fixture'), [folder], { stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const id = await new Promise((res, rej) => {
    const timeout = setTimeout(() => rej(new Error('Controlled window did not open within 10 seconds')), 10000);
    fixture.on('error', e => { clearTimeout(timeout); rej(e); });
    fixture.on('exit', code => { clearTimeout(timeout); rej(new Error(`Controlled window exited: ${code}`)); });
    let output = '';
    fixture.stdout.on('data', b => { output += b; const match = output.match(/window ID: (\d+)/); if (match) { clearTimeout(timeout); res(match[1]); } });
  });
  console.log('The controlled window turns orange near 10 seconds. Say “I’m changing this now” when it changes. Keep other speech to a minimum. No capture starts until you type record.');
  const code = await new Promise((res, rej) => {
    const child = spawn(process.execPath, [join(root, 'record.mjs'), '--window', id, '--duration', '30', '--out', folder], { stdio: 'inherit' });
    child.on('error', rej); child.on('exit', code => res(code));
  });
  if (code !== 0) throw new Error(`Recorder failed (${code}). Check permission guidance above.`);
  console.log(`Inspect and verify: node scripts/verify-session.mjs ${JSON.stringify(folder)} --live`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { fixture.kill('SIGTERM'); }
