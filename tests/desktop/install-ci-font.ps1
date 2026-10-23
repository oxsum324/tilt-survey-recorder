$ErrorActionPreference = 'Stop'
# A fixed upstream font is installed only on the disposable Windows CI worker.
$fontUrl = 'https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf'
$fontSha = 'dce08bd4fd91aa8aa76ed8fea4b694c2dfb8550f67871e326843212ddbeb88b4'
$fontTemp = Join-Path $env:TEMP 'tilt-NotoSansCJKtc-Regular.otf'
Invoke-WebRequest -Uri $fontUrl -OutFile $fontTemp
if ((Get-FileHash -LiteralPath $fontTemp -Algorithm SHA256).Hash.ToLowerInvariant() -ne $fontSha) {
  throw 'CI font SHA-256 mismatch'
}
$fontTarget = Join-Path $env:WINDIR 'Fonts\NotoSansCJKtc-Regular.otf'
Copy-Item -LiteralPath $fontTemp -Destination $fontTarget -Force
New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts' `
  -Name 'Noto Sans CJK TC Regular (OpenType)' -Value 'NotoSansCJKtc-Regular.otf' -PropertyType String -Force | Out-Null
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class TiltCiFont {
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
  public static extern int AddFontResourceW(string path);
}
'@
if ([TiltCiFont]::AddFontResourceW($fontTarget) -lt 1) { throw 'CI font registration failed' }
Write-Output "CI font installed; SHA-256 $fontSha"
