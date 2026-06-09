import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCapabilityRecordFromInstallInput,
  buildCapabilityRecordFromSmitheryInstallInput,
  buildSmitheryCapabilityRecord,
  searchSmitheryCatalog,
  searchSmitheryServers,
} from '../src/harness-sidecar/capabilities/smitheryRegistry.js';

test('smithery search normalizes registry results without storing API keys', async () => {
  const calls = [];
  const result = await searchSmitheryServers({
    query: 'browser',
    apiKey: 'smithery-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({
          servers: [
            {
              id: 'srv_1',
              qualifiedName: 'smithery/browser-tools',
              displayName: 'Browser Tools',
              description: 'Inspect pages and screenshots.',
              verified: true,
              remote: true,
              useCount: 123,
            },
          ],
        }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /https:\/\/api\.smithery\.ai\/servers/);
  assert.match(calls[0].url, /q=browser/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer smithery-secret');
  assert.equal(JSON.stringify(result).includes('smithery-secret'), false);
  assert.deepEqual(result.results.map((item) => item.qualifiedName), ['smithery/browser-tools']);
  assert.equal(result.results[0].installUrl, 'https://server.smithery.ai/smithery/browser-tools');
});

test('smithery result builds a local mcp capability record', () => {
  const record = buildSmitheryCapabilityRecord({
    qualifiedName: 'smithery/browser-tools',
    displayName: 'Browser Tools',
    installUrl: 'https://server.smithery.ai/smithery/browser-tools',
    description: 'Inspect pages and screenshots.',
    verified: true,
  });

  assert.equal(record.type, 'mcp');
  assert.equal(record.id, 'smithery:mcp:smithery-browser-tools');
  assert.equal(record.name, 'Browser Tools');
  assert.equal(record.enabled, true);
  assert.equal(record.url, 'https://server.smithery.ai/smithery/browser-tools');
  assert.equal(record.metadata.source, 'smithery');
  assert.equal(record.metadata.verified, true);
});

test('smithery installer parses skills cli commands and links into skill records', () => {
  const record = buildCapabilityRecordFromSmitheryInstallInput(
    'npx -y skills add https://smithery.ai/skills/anthropics/skill-creator',
  );

  assert.equal(record.type, 'skill');
  assert.equal(record.id, 'smithery:skill:anthropics-skill-creator');
  assert.equal(record.name, 'anthropics/skill-creator');
  assert.equal(record.enabled, true);
  assert.equal(record.pathOrCommandOrUrl, 'https://smithery.ai/skills/anthropics/skill-creator');
  assert.equal(record.url, 'https://smithery.ai/skills/anthropics/skill-creator');
  assert.equal(record.command, 'npx');
  assert.deepEqual(record.args, ['-y', 'skills', 'add', 'https://smithery.ai/skills/anthropics/skill-creator']);
  assert.equal(record.metadata.source, 'smithery');
  assert.equal(record.metadata.kind, 'skill');
  assert.equal(record.metadata.qualifiedName, 'anthropics/skill-creator');
});

test('smithery installer parses mcp urls into http mcp records', () => {
  const record = buildCapabilityRecordFromSmitheryInstallInput('https://mcp.smithery.run/jackjstark');

  assert.equal(record.type, 'mcp');
  assert.equal(record.id, 'smithery:mcp:jackjstark');
  assert.equal(record.name, 'jackjstark');
  assert.equal(record.enabled, true);
  assert.equal(record.transport, 'http');
  assert.equal(record.pathOrCommandOrUrl, 'https://mcp.smithery.run/jackjstark');
  assert.equal(record.url, 'https://mcp.smithery.run/jackjstark');
  assert.equal(record.metadata.kind, 'mcp');
});

test('unified installer parses Codex marketplace skill links and commands', () => {
  const linkRecord = buildCapabilityRecordFromInstallInput(
    'https://codex.openai.com/marketplace/skills/openai/code-review',
  );
  const commandRecord = buildCapabilityRecordFromInstallInput(
    'npx -y codex skills add https://codex.openai.com/marketplace/skills/openai/code-review',
  );

  for (const record of [linkRecord, commandRecord]) {
    assert.equal(record.type, 'skill');
    assert.equal(record.id, 'codex:skill:openai-code-review');
    assert.equal(record.name, 'openai/code-review');
    assert.equal(record.enabled, true);
    assert.equal(record.url, 'https://codex.openai.com/marketplace/skills/openai/code-review');
    assert.equal(record.command, 'npx');
    assert.deepEqual(record.args, ['-y', 'codex', 'skills', 'add', 'https://codex.openai.com/marketplace/skills/openai/code-review']);
    assert.equal(record.metadata.source, 'codex_marketplace');
    assert.equal(record.metadata.kind, 'skill');
    assert.equal(record.metadata.qualifiedName, 'openai/code-review');
  }
});

test('unified installer parses Codex marketplace plugin deep links', () => {
  const record = buildCapabilityRecordFromInstallInput('codex://plugins/openai-developers@openai-curated');

  assert.equal(record.type, 'skill');
  assert.equal(record.id, 'codex:plugin:openai-developers-openai-curated');
  assert.equal(record.name, 'openai-developers@openai-curated');
  assert.equal(record.pathOrCommandOrUrl, 'codex://plugins/openai-developers@openai-curated');
  assert.equal(record.metadata.source, 'codex_marketplace');
  assert.equal(record.metadata.kind, 'plugin');
  assert.equal(record.metadata.pluginName, 'openai-developers');
  assert.equal(record.metadata.marketplace, 'openai-curated');
});

test('unified installer parses Claude Code marketplace skill and mcp commands', () => {
  const skillRecord = buildCapabilityRecordFromInstallInput(
    'claude skill add https://github.com/anthropics/skills/tree/main/pdf',
  );
  const mcpRecord = buildCapabilityRecordFromInstallInput(
    'claude mcp add browser-tools https://example.com/mcp',
  );

  assert.equal(skillRecord.type, 'skill');
  assert.equal(skillRecord.id, 'claude:skill:pdf');
  assert.equal(skillRecord.name, 'pdf');
  assert.equal(skillRecord.url, 'https://github.com/anthropics/skills/tree/main/pdf');
  assert.equal(skillRecord.command, 'claude');
  assert.deepEqual(skillRecord.args, ['skill', 'add', 'https://github.com/anthropics/skills/tree/main/pdf']);
  assert.equal(skillRecord.metadata.source, 'claude_code_marketplace');

  assert.equal(mcpRecord.type, 'mcp');
  assert.equal(mcpRecord.id, 'claude:mcp:browser-tools');
  assert.equal(mcpRecord.name, 'browser-tools');
  assert.equal(mcpRecord.command, 'claude');
  assert.deepEqual(mcpRecord.args, ['mcp', 'add', 'browser-tools', 'https://example.com/mcp']);
  assert.equal(mcpRecord.metadata.source, 'claude_code_marketplace');
  assert.equal(mcpRecord.metadata.kind, 'mcp');
});

test('unified installer parses Claude Code marketplace plugin installs', () => {
  const record = buildCapabilityRecordFromInstallInput(
    'claude plugin install github@claude-plugins-official --scope user',
  );

  assert.equal(record.type, 'skill');
  assert.equal(record.id, 'claude:plugin:github-claude-plugins-official');
  assert.equal(record.name, 'github@claude-plugins-official');
  assert.equal(record.command, 'claude');
  assert.deepEqual(record.args, ['plugin', 'install', 'github@claude-plugins-official', '--scope', 'user']);
  assert.equal(record.pathOrCommandOrUrl, 'github@claude-plugins-official');
  assert.equal(record.metadata.source, 'claude_code_marketplace');
  assert.equal(record.metadata.kind, 'plugin');
  assert.equal(record.metadata.pluginName, 'github');
  assert.equal(record.metadata.marketplace, 'claude-plugins-official');
});

test('unified installer parses Pi Agent extension commands and paths', () => {
  const commandRecord = buildCapabilityRecordFromInstallInput(
    'pi extension add https://github.com/jackjstark/pi-kwargs',
  );
  const pathRecord = buildCapabilityRecordFromInstallInput(
    'C:\\Users\\jackj\\.pi\\agent\\extensions\\kwargs.ts',
  );

  assert.equal(commandRecord.type, 'pi_extension');
  assert.equal(commandRecord.id, 'pi_extension:pi-kwargs');
  assert.equal(commandRecord.name, 'pi-kwargs');
  assert.equal(commandRecord.url, 'https://github.com/jackjstark/pi-kwargs');
  assert.equal(commandRecord.command, 'pi');
  assert.deepEqual(commandRecord.args, ['extension', 'add', 'https://github.com/jackjstark/pi-kwargs']);
  assert.equal(commandRecord.metadata.source, 'pi_agent_extension');

  assert.equal(pathRecord.type, 'pi_extension');
  assert.equal(pathRecord.id, 'pi_extension:kwargs-ts');
  assert.equal(pathRecord.name, 'kwargs.ts');
  assert.equal(pathRecord.pathOrCommandOrUrl, 'C:\\Users\\jackj\\.pi\\agent\\extensions\\kwargs.ts');
  assert.equal('path' in pathRecord, false);
  assert.equal(pathRecord.metadata.source, 'pi_agent_extension');
});

test('smithery catalog search merges skills and mcp results without storing api keys', async () => {
  const calls = [];
  const result = await searchSmitheryCatalog({
    query: 'pdf',
    apiKey: 'smithery-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/skills')) {
        return {
          ok: true,
          json: async () => ({
            skills: [{
              namespace: 'anthropics',
              slug: 'pdf',
              displayName: 'PDF',
              description: 'Work with PDFs.',
              verified: true,
              totalActivations: 42,
            }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          servers: [{
            qualifiedName: 'smithery/pdf-tools',
            displayName: 'PDF Tools',
            description: 'MCP PDF tools.',
            useCount: 9,
          }],
        }),
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.ok(calls.some((call) => call.url.includes('https://api.smithery.ai/skills')));
  assert.ok(calls.some((call) => call.url.includes('https://api.smithery.ai/servers')));
  assert.equal(JSON.stringify(result).includes('smithery-secret'), false);
  assert.deepEqual(result.results.map((item) => item.kind), ['skill', 'mcp']);
  assert.equal(result.results[0].installUrl, 'https://smithery.ai/skills/anthropics/pdf');
  assert.equal(result.results[1].installUrl, 'https://server.smithery.ai/smithery/pdf-tools');
});
