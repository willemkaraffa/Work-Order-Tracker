# prep-python.ps1 -- builds the bundled Python runtime + Edge driver that ship
# with the app (electron-builder extraResources). Run before publish-win on a
# machine with network. Produces:
#   resources/python/python.exe   (embeddable Python + selenium installed)
#   resources/msedgedriver.exe    (matching the installed Edge major version)
# Both are gitignored; regenerate on any machine that builds a release.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/prep-python.ps1

$ErrorActionPreference = 'Stop'
$PyVer   = '3.12.7'                       # embeddable build to bundle
$Root    = Split-Path -Parent $PSScriptRoot
$ResDir  = Join-Path $Root 'resources'
$PyDir   = Join-Path $ResDir 'python'
$Tmp     = Join-Path $env:TEMP 'wot-prep-python'

New-Item -ItemType Directory -Force -Path $ResDir, $Tmp | Out-Null

# ── 1. Embeddable Python ──────────────────────────────────────────────────────
if (Test-Path $PyDir) { Remove-Item -Recurse -Force $PyDir }
New-Item -ItemType Directory -Force -Path $PyDir | Out-Null
$embedZip = Join-Path $Tmp "python-$PyVer-embed-amd64.zip"
Write-Host "[prep] downloading Python $PyVer embeddable..."
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$PyVer/python-$PyVer-embed-amd64.zip" -OutFile $embedZip
Expand-Archive -Path $embedZip -DestinationPath $PyDir -Force

# Enable site-packages so pip + selenium are importable from the embeddable build.
$pth = Get-ChildItem -Path $PyDir -Filter '*._pth' | Select-Object -First 1
(Get-Content $pth.FullName) `
    -replace '^#\s*import site', 'import site' `
    | Set-Content -Encoding ASCII $pth.FullName
if (-not (Select-String -Path $pth.FullName -Pattern 'Lib\\site-packages' -Quiet)) {
    Add-Content -Encoding ASCII $pth.FullName "Lib\site-packages"
}

# ── 2. pip + selenium into the embeddable build ───────────────────────────────
$getPip = Join-Path $Tmp 'get-pip.py'
Write-Host "[prep] bootstrapping pip..."
Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip
& (Join-Path $PyDir 'python.exe') $getPip --no-warn-script-location
Write-Host "[prep] installing selenium..."
& (Join-Path $PyDir 'python.exe') -m pip install --no-warn-script-location selenium

# ── 3. msedgedriver matching the installed Edge major version ─────────────────
$edge = Get-Item 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ErrorAction SilentlyContinue
if ($edge) {
    $ev = $edge.VersionInfo.ProductVersion
    Write-Host "[prep] Edge $ev -> fetching matching msedgedriver..."
    $drvZip = Join-Path $Tmp 'edgedriver.zip'
    try {
        Invoke-WebRequest -Uri "https://msedgedriver.microsoft.com/$ev/edgedriver_win64.zip" -OutFile $drvZip
        $drvOut = Join-Path $Tmp 'edgedriver'
        if (Test-Path $drvOut) { Remove-Item -Recurse -Force $drvOut }
        Expand-Archive -Path $drvZip -DestinationPath $drvOut -Force
        Copy-Item (Join-Path $drvOut 'msedgedriver.exe') (Join-Path $ResDir 'msedgedriver.exe') -Force
        Write-Host "[prep] msedgedriver.exe bundled."
    } catch {
        Write-Warning "[prep] msedgedriver download failed ($($_.Exception.Message)). The app will fall back to Selenium Manager (needs network on first run)."
    }
} else {
    Write-Warning "[prep] Edge not found; skipping msedgedriver (Selenium Manager fallback)."
}

# ── 4. verify the bundled interpreter can import selenium ──────────────────────
Write-Host "[prep] verifying bundled interpreter..."
& (Join-Path $PyDir 'python.exe') -c "import selenium; print('selenium', selenium.__version__, 'OK')"
Write-Host "[prep] done."
