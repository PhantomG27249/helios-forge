import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWindowsFolderPickerCommand,
  parseFolderPickerOutput,
  selectWorkspaceFolder,
} from '../src/workspace/workspacePicker.js';

test('windows workspace picker command uses the Explorer-style folder dialog and preserves initial directory', () => {
  const command = buildWindowsFolderPickerCommand({ initialDirectory: "C:\\Users\\jackj\\Github\\helios-forge" });

  assert.equal(command.file, 'powershell.exe');
  assert.ok(command.args.includes('-STA'));
  assert.ok(command.args.includes('-NoProfile'));
  assert.ok(command.args.includes('-ExecutionPolicy'));
  assert.match(command.args.at(-1), /IFileOpenDialog/);
  assert.match(command.args.at(-1), /FOS_PICKFOLDERS/);
  assert.doesNotMatch(command.args.at(-1), /FolderBrowserDialog/);
  assert.match(command.args.at(-1), /C:\\Users\\jackj\\Github\\helios-forge/);
});

test('workspace picker output parses selected and cancelled dialog results', () => {
  assert.deepEqual(
    parseFolderPickerOutput('{"selected":true,"path":"C:\\\\Users\\\\jackj\\\\Github\\\\helios-forge"}'),
    { selected: true, path: 'C:\\Users\\jackj\\Github\\helios-forge' },
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
      return { stdout: '{"selected":true,"path":"C:\\\\Users\\\\jackj\\\\Github\\\\helios-forge"}' };
    },
  });

  assert.equal(calls[0].file, 'powershell.exe');
  assert.ok(calls[0].args.includes('-STA'));
  assert.deepEqual(result, { selected: true, path: 'C:\\Users\\jackj\\Github\\helios-forge' });
});
