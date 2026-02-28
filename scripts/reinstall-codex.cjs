const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const extDir = path.join(process.env.APPDATA, 'singularity', 'extensions', 'openai.chatgpt');
const zipPath = path.join(process.env.APPDATA, 'singularity', 'extensions', 'openai.chatgpt-0.5.79.zip');
const storePath = path.join(process.env.APPDATA, 'singularity', 'singularity-extensions.json');

async function main() {
  // Download win32-x64 VSIX
  const url = 'https://open-vsx.org/api/openai/chatgpt/win32-x64/0.5.79/file/openai.chatgpt-0.5.79@win32-x64.vsix';
  console.log('Downloading Codex 0.5.79 (win32-x64)...');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Download failed: ' + resp.status);

  const fileStream = fs.createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(resp.body), fileStream);
  console.log('Downloaded');

  // Extract
  fs.mkdirSync(extDir, { recursive: true });
  console.log('Extracting...');
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extDir}' -Force"`,
    { timeout: 30000, windowsHide: true }
  );
  console.log('Extracted');

  // Clean zip
  fs.unlinkSync(zipPath);

  // Verify
  const pkgPath = path.join(extDir, 'extension', 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    console.log('Verified: ' + pkg.name + ' v' + pkg.version);
  }

  // Update store
  const data = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  data.installed['openai.chatgpt'] = {
    id: 'openai.chatgpt',
    namespace: 'openai',
    name: 'chatgpt',
    displayName: 'Codex',
    version: '0.5.79',
    description: 'Codex is a coding agent that writes code, fixes bugs, and answers questions.',
    publisher: 'openai',
    iconUrl: 'https://open-vsx.org/api/openai/chatgpt/0.5.79/file/resources/blossom-white.svg',
    installedAt: new Date().toISOString(),
    extensionPath: extDir,
    contributions: {
      commands: [],
      viewsContainers: [{ id: 'codexViewContainer', title: 'Codex' }],
      themes: [],
      languages: []
    }
  };
  fs.writeFileSync(storePath, JSON.stringify(data, null, '\t'));
  console.log('Store updated. Codex ready.');
}

main().catch(e => console.error('ERROR:', e));
