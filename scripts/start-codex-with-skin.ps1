<#
.SYNOPSIS
    Start Windows Codex with a local skin, then exit.

.DESCRIPTION
    This is a one-shot launcher. It locates the repository from PSScriptRoot,
    prepares the skin runtime under LocalAppData, starts Codex with a loopback-only
    CDP port when needed, waits for the application to finish loading, injects the
    skin, and exits. It does not create a watcher, service, scheduled task, or
    background process, and it never restarts Codex after the user closes it.

    The file is ASCII-only so Windows PowerShell 5.1 can parse it under any code page.
#>

[CmdletBinding()]
param(
    # Fallback theme if Codex has no valid skin stored by the top toolbar.
    [ValidatePattern('^(native|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$')]
    [string]$Theme = 'inkglass-aurora',

    # Loopback-only CDP port shared by Codex and the injector.
    [ValidateRange(1024, 65535)]
    [int]$Port = 9335,

    # Optional explicit ChatGPT.exe path when automatic discovery is unavailable.
    [string]$CodexExe,

    # Extra time to wait for CDP after the mandatory 12-second startup delay.
    [ValidateRange(5, 120)]
    [int]$WaitSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Stage {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "[CodexSkinSwitcher] $Message"
}

function Get-ValidCodexPath {
    param([AllowNull()][string]$Candidate)

    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        return $null
    }
    try {
        $item = Get-Item -LiteralPath $Candidate -ErrorAction Stop
        if (-not $item.PSIsContainer -and $item.Name -ieq 'ChatGPT.exe') {
            return $item.FullName
        }
    } catch {}
    return $null
}

function Get-RunningCodexPath {
    foreach ($process in @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)) {
        try {
            $path = Get-ValidCodexPath -Candidate $process.Path
            if ($path -and $path -like '*OpenAI.Codex*') {
                return $path
            }
        } catch {}
    }
    return $null
}

function Test-CodexRunning {
    return @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue).Count -gt 0
}

function Resolve-CodexPath {
    param(
        [AllowNull()][string]$ExplicitPath,
        [Parameter(Mandatory)][string]$CacheFile
    )

    if ($ExplicitPath) {
        $path = Get-ValidCodexPath -Candidate $ExplicitPath
        if (-not $path) {
            throw "-CodexExe is not a valid ChatGPT.exe file: $ExplicitPath"
        }
        return [pscustomobject]@{ Path = $path; Source = '-CodexExe' }
    }

    $path = Get-ValidCodexPath -Candidate $env:CODEX_APP_PATH
    if ($path) {
        return [pscustomobject]@{ Path = $path; Source = 'CODEX_APP_PATH' }
    }

    $path = Get-RunningCodexPath
    if ($path) {
        return [pscustomobject]@{ Path = $path; Source = 'running Codex' }
    }

    try {
        foreach ($package in @(Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop | Sort-Object Version -Descending)) {
            $path = Get-ValidCodexPath -Candidate (Join-Path $package.InstallLocation 'app\ChatGPT.exe')
            if ($path) {
                return [pscustomobject]@{ Path = $path; Source = 'Appx package metadata' }
            }
        }
    } catch {}

    try {
        if (Test-Path -LiteralPath $CacheFile -PathType Leaf) {
            $cache = Get-Content -LiteralPath $CacheFile -Raw | ConvertFrom-Json
            $path = Get-ValidCodexPath -Candidate $cache.codexExe
            if ($path) {
                return [pscustomobject]@{ Path = $path; Source = 'local cache' }
            }
        }
    } catch {}

    throw 'Codex was not found. Install Windows Codex or pass the full ChatGPT.exe path with -CodexExe.'
}

function Write-CodexPathCache {
    param(
        [Parameter(Mandatory)][string]$CacheFile,
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string]$Source
    )

    $value = [ordered]@{
        codexExe = $Executable
        source = $Source
        updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($CacheFile, "$value`n", $encoding)
}

function Test-CdpReady {
    param(
        [Parameter(Mandatory)][string]$NodeExe,
        [Parameter(Mandatory)][string]$Engine,
        [Parameter(Mandatory)][string]$StateRoot,
        [Parameter(Mandatory)][int]$CdpPort
    )

    & $NodeExe $Engine 'probe' '--root' $StateRoot '--port' ([string]$CdpPort) *> $null
    return $LASTEXITCODE -eq 0
}

function Wait-ForCdp {
    param(
        [Parameter(Mandatory)][string]$NodeExe,
        [Parameter(Mandatory)][string]$Engine,
        [Parameter(Mandatory)][string]$StateRoot,
        [Parameter(Mandatory)][int]$CdpPort,
        [Parameter(Mandatory)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-CdpReady -NodeExe $NodeExe -Engine $Engine -StateRoot $StateRoot -CdpPort $CdpPort) {
            return $true
        }
        Start-Sleep -Milliseconds 350
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-PortListener {
    param([Parameter(Mandatory)][int]$LocalPort)

    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        return $null
    }
    try {
        return @(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop)[0]
    } catch {
        return $null
    }
}

try {
    # Resolve every repository file from this script, not from the caller directory.
    $repositoryRoot = Split-Path -Parent $PSScriptRoot
    $sourceRuntime = Join-Path $repositoryRoot 'runtime'
    $sourceThemes = Join-Path $sourceRuntime 'themes'
    $sourceEngine = Join-Path $sourceRuntime 'skin.mjs'
    $sourceBaseCss = Join-Path $sourceRuntime 'base.css'
    $creatorSkill = Join-Path $repositoryRoot 'skills\skin-creator\SKILL.md'

    foreach ($requiredPath in @($sourceEngine, $sourceBaseCss, $sourceThemes, $creatorSkill)) {
        if (-not (Test-Path -LiteralPath $requiredPath)) {
            throw "This script must remain under a valid repository checkout. Missing: $requiredPath"
        }
    }

    $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        $nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
    }
    if (-not $nodeCommand) {
        throw 'Node.js was not found. Install Node.js 22 or later and ensure node is on PATH.'
    }
    $nodeExe = if ($nodeCommand.Path) { $nodeCommand.Path } else { $nodeCommand.Source }

    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA is empty, so the Windows runtime directory cannot be determined.'
    }
    $stateRoot = Join-Path $env:LOCALAPPDATA 'CodexSkinSwitcher'
    $runtimeRoot = Join-Path $stateRoot 'runtime'
    $themeRoot = Join-Path $stateRoot 'themes'
    $cacheFile = Join-Path $stateRoot 'windows-launcher.json'

    Write-Stage "Repository: $repositoryRoot"
    Write-Stage "Runtime: $stateRoot"
    New-Item -ItemType Directory -Force -Path $runtimeRoot, $themeRoot | Out-Null
    Copy-Item -LiteralPath $sourceEngine -Destination (Join-Path $runtimeRoot 'skin.mjs') -Force
    Copy-Item -LiteralPath $sourceBaseCss -Destination (Join-Path $runtimeRoot 'base.css') -Force

    # Preserve existing theme folders because they may contain user customizations.
    foreach ($themeDirectory in @(Get-ChildItem -LiteralPath $sourceThemes -Directory)) {
        $destination = Join-Path $themeRoot $themeDirectory.Name
        if (-not (Test-Path -LiteralPath $destination)) {
            Copy-Item -LiteralPath $themeDirectory.FullName -Destination $destination -Recurse
        }
    }

    $runtimeEngine = Join-Path $runtimeRoot 'skin.mjs'
    $cdpReady = Test-CdpReady -NodeExe $nodeExe -Engine $runtimeEngine -StateRoot $stateRoot -CdpPort $Port

    if ($Theme -eq 'native') {
        if ($cdpReady) {
            & $nodeExe $runtimeEngine 'remove' '--root' $stateRoot '--port' ([string]$Port)
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to restore the native interface (Node.js exit code: $LASTEXITCODE)."
            }
        }
        Write-Stage 'Native interface selected. No background process is running.'
        exit 0
    }

    if (-not (Test-Path -LiteralPath (Join-Path $themeRoot $Theme) -PathType Container)) {
        throw "Theme '$Theme' was not found under: $themeRoot"
    }

    if (-not $cdpReady) {
        # Do not terminate or relaunch a Codex instance that the user is currently using.
        if (Test-CodexRunning) {
            throw "Codex is already running without local CDP port $Port. Close Codex manually, then run this script again."
        }

        $listener = Get-PortListener -LocalPort $Port
        if ($listener) {
            throw "Port $Port is already listened to by process $($listener.OwningProcess). Choose a free port with -Port."
        }

        $resolvedCodex = Resolve-CodexPath -ExplicitPath $CodexExe -CacheFile $cacheFile
        Write-CodexPathCache -CacheFile $cacheFile -Executable $resolvedCodex.Path -Source $resolvedCodex.Source
        Write-Stage "Codex: $($resolvedCodex.Path) ($($resolvedCodex.Source))"
        Write-Stage "Launching Codex with 127.0.0.1:$Port..."
        Start-Process -FilePath $resolvedCodex.Path -ArgumentList @(
            "--remote-debugging-port=$Port",
            '--remote-debugging-address=127.0.0.1'
        ) -ErrorAction Stop | Out-Null

        # Keep the proven macOS delay: a CDP target appears before the page is safe
        # for document.body toolbar injection. This launcher waits, injects, and exits.
        Write-Stage 'Waiting 12 seconds for Codex to finish loading...'
        Start-Sleep -Seconds 12
        if (-not (Wait-ForCdp -NodeExe $nodeExe -Engine $runtimeEngine -StateRoot $stateRoot -CdpPort $Port -TimeoutSeconds $WaitSeconds)) {
            throw "The Codex CDP page did not appear on port $Port within the allowed time."
        }
    }

    Write-Stage "Applying skin (fallback theme: $Theme)..."
    & $nodeExe $runtimeEngine 'apply' '--resume' '--root' $stateRoot '--port' ([string]$Port) '--theme' $Theme '--creator-skill-path' $creatorSkill
    if ($LASTEXITCODE -ne 0) {
        throw "Skin injection failed (Node.js exit code: $LASTEXITCODE)."
    }

    $inspection = & $nodeExe $runtimeEngine 'inspect' '--root' $stateRoot '--port' ([string]$Port)
    if ($LASTEXITCODE -ne 0) {
        throw "Skin status inspection failed (Node.js exit code: $LASTEXITCODE)."
    }
    $status = $inspection | Out-String | ConvertFrom-Json
    Write-Stage "Applied skin: $($status.id). The launcher is exiting; Codex will not be restarted when you close it."
} catch {
    Write-Error "[CodexSkinSwitcher] $($_.Exception.Message)"
    exit 1
}
