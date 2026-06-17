import { copyFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(repoRoot, 'build');
const publicDir = path.join(repoRoot, 'public');
const iconPng = path.join(buildDir, 'icon.png');
const iconIco = path.join(buildDir, 'icon.ico');

mkdirSync(buildDir, { recursive: true });

const psScript = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 230, 126, 34))
$graphics.FillRectangle($brush, 0, 0, 256, 256)
$font = New-Object System.Drawing.Font('Segoe UI', 48, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$graphics.DrawString('H', $font, $textBrush, 88, 88)
$graphics.Dispose()
$bmp.Save('${iconPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$stream = [System.IO.File]::Create('${iconIco.replace(/'/g, "''")}')
$icon.Save($stream)
$stream.Close()
$icon.Dispose()
$bmp.Dispose()
`;

execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
  stdio: 'inherit',
});

copyFileSync(iconPng, path.join(publicDir, 'icon.png'));
console.log('Generated build/icon.png, build/icon.ico, and public/icon.png');
