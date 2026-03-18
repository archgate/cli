# Archgate installer for Windows
# Usage: irm https://raw.githubusercontent.com/archgate/cli/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "archgate/cli"
$Artifact = "archgate-win32-x64"
$InstallDir = if ($env:ARCHGATE_INSTALL_DIR) { $env:ARCHGATE_INSTALL_DIR } else { "$HOME\.archgate\bin" }

# --- Check architecture ---

$Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($Arch -ne "X64") {
    Write-Error "Error: unsupported architecture: $Arch. archgate supports x64 only on Windows."
    exit 1
}

# --- Resolve version ---

function Get-LatestVersion {
    if ($env:ARCHGATE_VERSION) {
        return $env:ARCHGATE_VERSION
    }
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
    return $release.tag_name
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
    Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing

    Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    Move-Item -Path (Join-Path $TmpDir "archgate.exe") -Destination (Join-Path $InstallDir "archgate.exe") -Force
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
        Write-Host "  [Environment]::SetEnvironmentVariable('Path', '$InstallDir;' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
    } else {
        [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$CurrentPath", "User")
        $env:Path = "$InstallDir;$env:Path"
        Write-Host "  Updated user PATH."
    }
    Write-Host ""
    Write-Host "Restart your terminal for the change to take effect in new sessions."
}

Write-Host ""
Write-Host "Run 'archgate --help' to get started."
