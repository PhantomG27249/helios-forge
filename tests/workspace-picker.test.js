import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWindowsFolderPickerCommand,
  parseFolderPickerOutput,
  selectWorkspaceFolder,
} from '../src/workspace/workspacePicker.js';

test('windows workspace picker command uses STA PowerShell and preserves initial directory', () => {
  const command = buildWindowsFolderPickerCommand({ initialDirectory: "C:\\Users\\jackj\\Github\\chat-app" });

  assert.equal(command.file, 'powershell.exe');
  assert.ok(command.args.includes('-STA'));
  assert.ok(command.args.includes('-NoProfile'));
  assert.ok(command.args.includes('-ExecutionPolicy'));
  assert.match(command.args.at(-1), /FolderBrowserDialog/);
  assert.match(command.args.at(-1), /C:\\Users\\jackj\\Github\\chat-app/);
});

test('workspace picker output parses selected and cancelled dialog results', () => {
  assert.deepEqual(
    parseFolderPickerOutput('{"selected":true,"path":"C:\\\\Users\\\\jackj\\\\Github\\\\chat-app"}'),
    { selected: true, path: 'C:\\Users\\jackj\\Github\\chat-app' },
  );
  assert.deepEqual(parseFolderPickerOutput('{"selected":false}'), { selected: false });
});

test('workspace picker runs the platform command and returns the selected path', async () => {
  const calls = [];
  const result = await selectWorkspaceFolder({
    platform: 'win32',
    initialDirectory: 'C:\\Users\\jackj\\Github',
    execFileImpl: async (file, args) => {
      calls.push({ file, args });
      return { stdout: '{"selected":true,"path":"C:\\\\Users\\\\jackj\\\\Github\\\\chat-app"}' };
    },
  });

  assert.equal(calls[0].file, 'powershell.exe');
  assert.ok(calls[0].args.includes('-STA'));
  assert.deepEqual(result, { selected: true, path: 'C:\\Users\\jackj\\Github\\chat-app' });
});

