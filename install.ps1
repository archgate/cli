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

# --- Release asset helpers ---

function Get-AssetUrl {
    param([string]$Version)
    return "https://github.com/$Repo/releases/download/$Version/$Artifact.zip"
}

# Returns $true when the platform asset for the given version tag actually
# exists on GitHub Releases. A version being advertised (version.json,
# releases/latest) does not guarantee its assets are uploaded yet - releases
# are published before the binary build workflow finishes, and a failed
# release pipeline can advertise a version that never gets assets at all.
function Test-AssetExists {
    param([string]$Version)
    try {
        Invoke-WebRequest -Uri (Get-AssetUrl $Version) -Method Head -UseBasicParsing -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

# --- Resolve version ---

function Get-LatestVersion {
    if ($env:ARCHGATE_VERSION) {
        if (-not (Test-AssetExists $env:ARCHGATE_VERSION)) {
            Write-Host "Error: no $Artifact.zip asset found for pinned ARCHGATE_VERSION='$($env:ARCHGATE_VERSION)'." -ForegroundColor Red
            Write-Host "Check that the release exists and has finished building: https://github.com/$Repo/releases"
            return $null
        }
        return $env:ARCHGATE_VERSION
    }

    # Primary: static version endpoint (no rate limits)
    try {
        $versionInfo = Invoke-RestMethod -Uri "https://cli.archgate.dev/version.json" -ErrorAction Stop
        if ($versionInfo.version) {
            # The version endpoint can advertise a release before its binaries
            # are uploaded (or one whose release pipeline failed). Trust it
            # only when the platform asset is actually downloadable.
            if (Test-AssetExists $versionInfo.version) {
                return $versionInfo.version
            }
            Write-Warning "$($versionInfo.version) is advertised but its release assets are not available yet (release may be in progress). Falling back to the newest installable release..."
        }
    } catch {
        Write-Verbose "version.json lookup failed: $($_.Exception.Message); falling back to GitHub API"
    }

    # Fallback: walk recent GitHub releases (newest first) and pick the first
    # one whose platform asset exists. 'releases/latest' alone is not enough -
    # it returns a release as soon as it is published, before assets upload.
    $releases = $null
    try {
        $headers = @{ "Accept" = "application/vnd.github+json" }
        if ($env:GITHUB_TOKEN) {
            $headers["Authorization"] = "token $($env:GITHUB_TOKEN)"
        }
        $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=10" -Headers $headers -ErrorAction Stop
    } catch {
        Write-Error "Error: failed to query latest archgate version. Details: $($_.Exception.Message)"
        return $null
    }

    foreach ($release in $releases) {
        if ($release.tag_name -and (Test-AssetExists $release.tag_name)) {
            return $release.tag_name
        }
    }

    Write-Host "Error: none of the recent releases have a $Artifact.zip asset." -ForegroundColor Red
    Write-Host "Visit https://github.com/$Repo/releases or https://cli.archgate.dev/getting-started/installation/ for alternative install methods."
    return $null
}

$Version = Get-LatestVersion
if (-not $Version) {
    Write-Error "Error: could not determine latest version."
    exit 1
}

# --- Download and install ---

$Url = Get-AssetUrl $Version

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

# --- Update shell profiles (Git Bash + PowerShell) ---
#
# These shells share the Windows ecosystem but each have their own profile
# system. We detect existing profiles only (never create new ones) and
# prompt once for the whole batch.

$ProfileUpdates = @()

# Git Bash / MSYS2 - first matching rc file wins
$InstallDirPosix = $InstallDir -replace '\\', '/'
if ($InstallDirPosix -match '^([A-Za-z]):') {
    $InstallDirPosix = '/' + $Matches[1].ToLower() + $InstallDirPosix.Substring(2)
}
$BashLine = "export PATH=`"${InstallDirPosix}:`$PATH`""
foreach ($f in @("$HOME\.bashrc", "$HOME\.bash_profile", "$HOME\.profile")) {
    if (Test-Path $f) {
        $ProfileUpdates += [pscustomobject]@{
            Path  = $f
            Line  = $BashLine
            Label = "Git Bash"
            Match = $InstallDirPosix
        }
        break
    }
}

# PowerShell 5.1 (Windows PowerShell) and PowerShell 7+ have separate profile
# paths and can coexist on the same machine - detect both. Use
# GetFolderPath('MyDocuments') so OneDrive-redirected Documents folders work.
try {
    $DocsDir = [Environment]::GetFolderPath('MyDocuments')
} catch {
    $DocsDir = "$HOME\Documents"
}
$PSLine = "`$env:PATH = `"$InstallDir;`$env:PATH`""
$PSProfileCandidates = @(
    @{ Path = Join-Path $DocsDir "WindowsPowerShell\Microsoft.PowerShell_profile.ps1"; Label = "PowerShell 5.1" },
    @{ Path = Join-Path $DocsDir "PowerShell\Microsoft.PowerShell_profile.ps1"; Label = "PowerShell 7+" }
)
foreach ($entry in $PSProfileCandidates) {
    if (Test-Path $entry.Path) {
        $ProfileUpdates += [pscustomobject]@{
            Path  = $entry.Path
            Line  = $PSLine
            Label = $entry.Label
            Match = $InstallDir
        }
    }
}

# Filter to profiles that don't already reference the install dir.
# Read failures are warnings, not fatal - skip the file and continue.
$NeedsUpdate = @()
foreach ($entry in $ProfileUpdates) {
    try {
        $alreadyHas = Select-String -Path $entry.Path -SimpleMatch $entry.Match -Quiet -ErrorAction Stop
        if (-not $alreadyHas) {
            $NeedsUpdate += $entry
        }
    } catch {
        Write-Warning "Could not read $($entry.Path): $($_.Exception.Message)"
    }
}

if ($NeedsUpdate.Count -gt 0) {
    Write-Host ""
    Write-Host "Detected shell profiles to update:"
    foreach ($entry in $NeedsUpdate) {
        Write-Host "  [$($entry.Label)] $($entry.Path)"
        Write-Host "      $($entry.Line)"
    }
    Write-Host ""

    $answer = Read-Host "Update these files now? [Y/n]"
    if ($answer -match '^[nN]') {
        Write-Host ""
        Write-Host "Skipped. To add manually, append the corresponding line above to each profile."
    } else {
        $updated = 0
        $failed = 0
        foreach ($entry in $NeedsUpdate) {
            try {
                Add-Content -Path $entry.Path -Value "`n# archgate`n$($entry.Line)" -ErrorAction Stop
                Write-Host "  Updated: $($entry.Path)"
                $updated++
            } catch {
                Write-Warning "Failed to update $($entry.Path): $($_.Exception.Message)"
                Write-Host "  Manually append to that file:"
                Write-Host "      $($entry.Line)"
                $failed++
            }
        }
        Write-Host ""
        if ($updated -gt 0) {
            Write-Host "Restart the relevant shell(s) for the change to take effect."
        }
        if ($failed -gt 0) {
            Write-Host "$failed profile(s) could not be updated automatically - see warnings above."
        }
    }
}

Write-Host ""
Write-Host "Run 'archgate --help' to get started."
