import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function quotePowerShellString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

export function buildWindowsFolderPickerCommand({ initialDirectory = '' } = {}) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select Helios Forge workspace'
$dialog.ShowNewFolderButton = $true
$initialDirectory = ${quotePowerShellString(initialDirectory)}
if ($initialDirectory -and [System.IO.Directory]::Exists($initialDirectory)) {
  $dialog.SelectedPath = $initialDirectory
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [pscustomobject]@{ selected = $true; path = $dialog.SelectedPath } | ConvertTo-Json -Compress
} else {
  [pscustomobject]@{ selected = $false } | ConvertTo-Json -Compress
}
$dialog.Dispose()
`.trim();

  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
  };
}

export function parseFolderPickerOutput(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return { selected: false };
  const parsed = JSON.parse(raw);
  if (!parsed.selected) return { selected: false };
  if (!parsed.path || typeof parsed.path !== 'string') {
    throw new Error('Folder picker returned no path');
  }
  return { selected: true, path: parsed.path };
}

export async function selectWorkspaceFolder({
  initialDirectory = '',
  platform = process.platform,
  execFileImpl = execFileAsync,
} = {}) {
  if (platform !== 'win32') {
    return { selected: false, unsupported: true, reason: 'native workspace picker is only implemented on Windows' };
  }

  const command = buildWindowsFolderPickerCommand({ initialDirectory });
  const result = await execFileImpl(command.file, command.args, { windowsHide: false });
  return parseFolderPickerOutput(result.stdout);
}

