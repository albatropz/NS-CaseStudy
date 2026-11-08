const { spawnSync } = require('node:child_process');

const filename = process.argv[2];

if (!filename) {
    console.error('Usage: npm run upload -- filename.js');
    process.exit(1);
}

const path = `/SuiteScripts/${filename}`;

const result = spawnSync(
    'suitecloud',
    ['file:upload', '--paths', path],
    {
        stdio: 'inherit',
        shell: process.platform === 'win32'
    }
);

process.exit(result.status ?? 1);