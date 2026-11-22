import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliArgs, saveCliConfig, loadCliConfig, executeCliCommand } from '../src/index.js';

test('CLI parseCliArgs și salvare configurație fără parolă de administrator', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'starli-cli-test-'));
  const configPath = join(dir, 'config.json');

  const parsed = parseCliArgs(['proposals', 'create', '--lead', 'lead-123', '--summary', 'Cafenea Brașov', '--json']);
  assert.deepEqual(parsed.positionals, ['proposals', 'create']);
  assert.equal(parsed.flags.lead, 'lead-123');
  assert.equal(parsed.flags.summary, 'Cafenea Brașov');
  assert.equal(parsed.json, true);

  saveCliConfig(
    {
      apiUrl: 'https://api.starlidigital.ro/',
      operatorToken: 'starli_op_test123456789012345678901234567890',
      activeConversationId: 'conv-1'
    },
    configPath
  );

  const loaded = loadCliConfig(configPath);
  assert.equal(loaded.apiUrl, 'https://api.starlidigital.ro');
  assert.equal(loaded.operatorToken, 'starli_op_test123456789012345678901234567890');
  assert.equal(loaded.activeConversationId, 'conv-1');

  const outputs: string[] = [];
  await executeCliCommand(['help', '--json'], {
    configPath,
    output: (txt) => outputs.push(txt)
  });
  const helpJson = JSON.parse(outputs[0]);
  assert.equal(helpJson.binary, 'starli');
  assert.ok(Array.isArray(helpJson.commands));
});
