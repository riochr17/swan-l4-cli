const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const entryPoint = './exec.ts';
const outputDir = './bin';

const targets = [
  { target: 'bun-linux-x64', name: 'l4cli-linux-x64' },
  { target: 'bun-linux-arm64', name: 'l4cli-linux-arm64' },
  { target: 'bun-darwin-x64', name: 'l4cli-macos-x64' },
  { target: 'bun-darwin-arm64', name: 'l4cli-macos-arm64' },
  { target: 'bun-windows-x64', name: 'l4cli-windows-x64.exe' }
];

console.log('Preparing build directory...');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

for (const { target, name } of targets) {
  const outputPath = path.join(outputDir, name);
  console.log(`Building for ${target} -> ${outputPath}...`);
  try {
    execSync(`npx -y bun build --compile --target=${target} ${entryPoint} --outfile ${outputPath}`, {
      stdio: 'inherit'
    });
    console.log(`Successfully built ${name}\n`);
  } catch (error) {
    console.error(`Failed to build for target ${target}:`, error.message, '\n');
  }
}

console.log('All builds completed!');
