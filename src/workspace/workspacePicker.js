import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function quotePowerShellString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

export function buildWindowsFolderPickerCommand({ initialDirectory = '' } = {}) {
  const script = `
if (-not ('HeliosForge.WorkspacePicker.IFileOpenDialog' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace HeliosForge.WorkspacePicker {
  [ComImport]
  [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  public class FileOpenDialog {}

  [ComImport]
  [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint fos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, uint fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
  }

  [ComImport]
  [Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IFileOpenDialog : IFileDialog {
    void GetResults(out IntPtr ppenum);
    void GetSelectedItems(out IntPtr ppsai);
  }

  [ComImport]
  [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  public static class NativeMethods {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    public static extern void SHCreateItemFromParsingName(
      string pszPath,
      IntPtr pbc,
      ref Guid riid,
      out IShellItem ppv
    );
  }

  public static class Picker {
    const uint FOS_PICKFOLDERS = 0x00000020;
    const uint FOS_FORCEFILESYSTEM = 0x00000040;
    const uint FOS_NOCHANGEDIR = 0x00000008;
    const uint FOS_PATHMUSTEXIST = 0x00000800;
    const uint SIGDN_FILESYSPATH = 2147844096;
    const int ERROR_CANCELLED = unchecked((int)0x800704C7);

    public static string SelectFolder(string initialDirectory) {
      IFileOpenDialog dialog = null;
      IShellItem folderItem = null;
      IShellItem resultItem = null;
      IntPtr namePtr = IntPtr.Zero;

      try {
        dialog = (IFileOpenDialog)new FileOpenDialog();
        uint options;
        dialog.GetOptions(out options);
        dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_PATHMUSTEXIST);
        dialog.SetTitle("Select Helios Forge workspace");
        dialog.SetOkButtonLabel("Select Folder");

        if (!String.IsNullOrWhiteSpace(initialDirectory) && System.IO.Directory.Exists(initialDirectory)) {
          try {
            Guid shellItemId = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
            NativeMethods.SHCreateItemFromParsingName(initialDirectory, IntPtr.Zero, ref shellItemId, out folderItem);
            if (folderItem != null) {
              dialog.SetFolder(folderItem);
            }
          } catch {
            // Ignore invalid initial folders and let Windows choose the default location.
          }
        }

        int hr = dialog.Show(IntPtr.Zero);
        if (hr == ERROR_CANCELLED) return null;
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);

        dialog.GetResult(out resultItem);
        resultItem.GetDisplayName(SIGDN_FILESYSPATH, out namePtr);
        return Marshal.PtrToStringUni(namePtr);
      } finally {
        if (namePtr != IntPtr.Zero) Marshal.FreeCoTaskMem(namePtr);
        if (resultItem != null) Marshal.ReleaseComObject(resultItem);
        if (folderItem != null) Marshal.ReleaseComObject(folderItem);
        if (dialog != null) Marshal.ReleaseComObject(dialog);
      }
    }
  }
}
'@
}

$initialDirectory = ${quotePowerShellString(initialDirectory)}
$selectedPath = [HeliosForge.WorkspacePicker.Picker]::SelectFolder($initialDirectory)
if ($selectedPath) {
  [pscustomobject]@{ selected = $true; path = $selectedPath } | ConvertTo-Json -Compress
} else {
  [pscustomobject]@{ selected = $false } | ConvertTo-Json -Compress
}
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
