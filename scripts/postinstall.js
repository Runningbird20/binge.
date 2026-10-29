const { execSync } = require('node:child_process');

function run(command) {
  execSync(command, {
    stdio: 'inherit',
    shell: true,
  });
}

run('npx patch-package');
