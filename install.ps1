# Archgate installer for Windows
# Usage: irm https://raw.githubusercontent.com/archgate/cli/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "archgate/cli"
$Artifact = "archgate-win32-x64"
$InstallDir = if ($env:ARCHGATE_INSTALL_DIR) { $env:ARCHGATE_INSTALL_DIR } else { "$HOME\.archgate\bin" }

# --- Check architecture ---

$Arch = $env:PROCESSOR_ARCHITECTURE
if ($Arch -ne "AMD64") {
    Write-Error "Error: unsupported architecture: $Arch. archgate supports x64 only on Windows."
    exit 1
}

# --- Resolve version ---

function Get-LatestVersion {
    if ($env:ARCHGATE_VERSION) {
        return $env:ARCHGATE_VERSION
    }
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -ErrorAction Stop
        return $release.tag_name
    } catch {
        Write-Error "Error: failed to query GitHub for latest archgate version. Details: $($_.Exception.Message)"
        return $null
    }
}

$Version = Get-LatestVersion
if (-not $Version) {
    Write-Error "Error: could not determine latest version."
    exit 1
}

# --- Download and install ---

$Url = "https://github.com/$Repo/releases/download/$Version/$Artifact.zip"

Write-Host "Installing archgate $Version ($Artifact)..."

$TmpDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "archgate-install-$(Get-Random)")
try {
    $ZipPath = Join-Path $TmpDir "archgate.zip"
    Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing -ErrorAction Stop

    Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $ExtractedExe = Join-Path $TmpDir "archgate.exe"
    if (-not (Test-Path $ExtractedExe)) {
        Write-Error "Error: 'archgate.exe' was not found in the extracted archive at '$ExtractedExe'. The downloaded package may be corrupt or incompatible."
        exit 1
    }

    Move-Item -Path $ExtractedExe -Destination (Join-Path $InstallDir "archgate.exe") -Force
} catch {
    Write-Error "Error: failed to download archgate from $Url. Please verify the version '$Version' exists and check your network connection. $($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "archgate $Version installed to $InstallDir\archgate.exe"

# --- Update PATH ---

$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
    Write-Host ""
    Write-Host "archgate is not on your PATH."
    Write-Host ""
    Write-Host "  Will add: $InstallDir"
    Write-Host ""

    $answer = Read-Host "Add to your user PATH now? [Y/n]"
    if ($answer -match '^[nN]') {
        Write-Host ""
        Write-Host "Skipped. To add manually, run:"
        Write-Host ""
        Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$InstallDir;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
    } else {
        [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$CurrentPath", "User")
        $env:Path = "$InstallDir;$env:Path"
        Write-Host "  Updated user PATH."
    }
    Write-Host ""
    Write-Host "Restart your terminal for the change to take effect in new sessions."
}

# --- Update Git Bash / MSYS2 shell profiles ---

$GitBashProfiles = @()
foreach ($f in @("$HOME\.bashrc", "$HOME\.bash_profile", "$HOME\.profile")) {
    if (Test-Path $f) {
        $GitBashProfiles += $f
        break
    }
}

$InstallDirPosix = $InstallDir -replace '\\', '/'
if ($InstallDirPosix -match '^([A-Za-z]):') {
    $InstallDirPosix = '/' + $Matches[1].ToLower() + $InstallDirPosix.Substring(2)
}
$PathLine = "export PATH=`"${InstallDirPosix}:`$PATH`""

$NeedsUpdate = @()
foreach ($f in $GitBashProfiles) {
    if (-not (Select-String -Path $f -SimpleMatch $InstallDirPosix -Quiet)) {
        $NeedsUpdate += $f
    }
}

if ($NeedsUpdate.Count -gt 0) {
    Write-Host ""
    Write-Host "Detected Git Bash shell profiles to update:"
    foreach ($f in $NeedsUpdate) {
        Write-Host "  $f  ->  $PathLine"
    }
    Write-Host ""

    $answer = Read-Host "Update these files now? [Y/n]"
    if ($answer -match '^[nN]') {
        Write-Host ""
        Write-Host "Skipped. To add manually, append this line to your shell profile:"
        Write-Host ""
        Write-Host "  $PathLine"
    } else {
        foreach ($f in $NeedsUpdate) {
            Add-Content -Path $f -Value "`n# archgate`n$PathLine"
            Write-Host "  Updated: $f"
        }
        Write-Host ""
        Write-Host "Restart Git Bash for the change to take effect."
    }
}

Write-Host ""
Write-Host "Run 'archgate --help' to get started."
