const { execSync } = require('node:child_process');

function run(command) {
  execSync(command, {
    stdio: 'inherit',
    shell: true,
  });
}

run('npx patch-package');

if (process.env.VERCEL === '1') {
  console.log('Skipping better-sqlite3 rebuild on Vercel for the frontend deployment.');
  process.exit(0);
}

run('npm rebuild better-sqlite3');
