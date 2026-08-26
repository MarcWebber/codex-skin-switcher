<#
.SYNOPSIS
    Start Windows Codex with a local skin, then exit.

.DESCRIPTION
    Copies the plugin runtime to LocalAppData, starts Codex with a loopback-only
    CDP port when necessary, applies one skin, and exits. It creates no watcher,
    service, scheduled task, or other background process.
#>

[CmdletBinding()]
param(
    [ValidatePattern('^(native|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$')]
    [string]$Theme,

    [ValidateRange(1024, 65535)]
    [int]$Port = 9335,

    [string]$CodexExe,

    [ValidateRange(5, 120)]
    [int]$WaitSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$themeSpecified = $PSBoundParameters.ContainsKey('Theme')
if (-not $themeSpecified) {
    $Theme = 'inkglass-aurora'
}

function Write-Stage {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "[CodexSkinSwitcher] $Message"
}

function Get-ExecutablePath {
    param([AllowNull()][string]$Candidate)

    if ([string]::IsNullOrWhiteSpace($Candidate)) {
        return $null
    }
    $item = Get-Item -LiteralPath $Candidate -ErrorAction SilentlyContinue
    if ($item -and -not $item.PSIsContainer -and $item.Name -ieq 'ChatGPT.exe') {
        return $item.FullName
    }
    return $null
}

function Get-RunningCodex {
    foreach ($process in @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue)) {
        try {
            $path = Get-ExecutablePath -Candidate $process.Path
        } catch {
            continue
        }
        if ($path -and $path -like '*OpenAI.Codex*') {
            return $process
        }
    }
    return $null
}

function Resolve-CodexExecutable {
    param([AllowNull()][string]$ExplicitPath)

    if ($ExplicitPath) {
        $path = Get-ExecutablePath -Candidate $ExplicitPath
        if (-not $path) {
            throw "-CodexExe is not a valid ChatGPT.exe file: $ExplicitPath"
        }
        return $path
    }

    $path = Get-ExecutablePath -Candidate $env:CODEX_APP_PATH
    if ($path) {
        return $path
    }

    $package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if ($package) {
        $path = Get-ExecutablePath -Candidate (Join-Path $package.InstallLocation 'app\ChatGPT.exe')
        if ($path) {
            return $path
        }
    }

    throw 'Codex was not found. Install Windows Codex, set CODEX_APP_PATH, or pass -CodexExe.'
}

function Test-CdpReady {
    & $nodeExe $runtimeEngine 'ready' '--root' $stateRoot '--port' ([string]$Port) *> $null
    return $LASTEXITCODE -eq 0
}

function Wait-CdpReady {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    do {
        if (Test-CdpReady) {
            return $true
        }
        Start-Sleep -Milliseconds 350
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Invoke-SkinRuntime {
    param(
        [Parameter(Mandatory)][string]$Command,
        [string[]]$Arguments = @()
    )

    $output = & $nodeExe $runtimeEngine $Command '--root' $stateRoot '--port' ([string]$Port) @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed (Node.js exit code: $LASTEXITCODE)."
    }
    return $output
}

try {
    $pluginRoot = Split-Path -Parent $PSScriptRoot
    $sourceRuntime = Join-Path $pluginRoot 'runtime'
    $sourceThemes = Join-Path $sourceRuntime 'themes'
    $sourceEngine = Join-Path $sourceRuntime 'skin.mjs'
    $sourceBaseCss = Join-Path $sourceRuntime 'base.css'
    $creatorSkill = Join-Path $pluginRoot 'skills\skin-creator\SKILL.md'

    foreach ($requiredPath in @($sourceEngine, $sourceBaseCss, $sourceThemes, $creatorSkill)) {
        if (-not (Test-Path -LiteralPath $requiredPath)) {
            throw "Incomplete plugin package. Missing: $requiredPath"
        }
    }

    $nodeCommand = Get-Command -Name 'node.exe', 'node' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $nodeCommand) {
        throw 'Node.js was not found. Install Node.js 22 or later and ensure node is on PATH.'
    }
    $nodeExe = $nodeCommand.Source

    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA is empty, so the Windows runtime directory cannot be determined.'
    }
    $stateRoot = Join-Path $env:LOCALAPPDATA 'CodexSkinSwitcher'
    $runtimeRoot = Join-Path $stateRoot 'runtime'
    $themeRoot = Join-Path $stateRoot 'themes'
    $runtimeEngine = Join-Path $runtimeRoot 'skin.mjs'

    Write-Stage "Plugin: $pluginRoot"
    Write-Stage "Runtime: $stateRoot"
    New-Item -ItemType Directory -Force -Path $runtimeRoot, $themeRoot | Out-Null
    Copy-Item -LiteralPath $sourceEngine -Destination $runtimeEngine -Force
    Copy-Item -LiteralPath $sourceBaseCss -Destination (Join-Path $runtimeRoot 'base.css') -Force

    foreach ($themeDirectory in @(Get-ChildItem -LiteralPath $sourceThemes -Directory)) {
        $destination = Join-Path $themeRoot $themeDirectory.Name
        if (-not (Test-Path -LiteralPath $destination)) {
            Copy-Item -LiteralPath $themeDirectory.FullName -Destination $destination -Recurse
        }
    }

    $cdpReady = Test-CdpReady
    if ($Theme -eq 'native') {
        if ($cdpReady) {
            Invoke-SkinRuntime -Command 'remove' | Out-Null
        }
        Write-Stage 'Native interface selected. No background process is running.'
        exit 0
    }

    if (-not (Test-Path -LiteralPath (Join-Path $themeRoot $Theme) -PathType Container)) {
        throw "Theme '$Theme' was not found under: $themeRoot"
    }

    if (-not $cdpReady) {
        if (Get-RunningCodex) {
            throw "Codex is already running without local CDP port $Port. Close Codex, then run this script again."
        }

        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($listener) {
            throw "Port $Port is already used by process $($listener.OwningProcess). Choose another port with -Port."
        }

        $resolvedCodex = Resolve-CodexExecutable -ExplicitPath $CodexExe
        Write-Stage "Launching: $resolvedCodex"
        Start-Process -FilePath $resolvedCodex -ArgumentList @(
            "--remote-debugging-port=$Port",
            '--remote-debugging-address=127.0.0.1'
        ) -ErrorAction Stop | Out-Null

        if (-not (Wait-CdpReady)) {
            throw "Codex did not become ready on port $Port within $WaitSeconds seconds."
        }
    }

    $applyArguments = @('--theme', $Theme, '--creator-skill-path', $creatorSkill)
    if (-not $themeSpecified) {
        $applyArguments = @('--resume') + $applyArguments
    }
    Invoke-SkinRuntime -Command 'apply' -Arguments $applyArguments | Out-Null

    $status = Invoke-SkinRuntime -Command 'inspect' | Out-String | ConvertFrom-Json
    Write-Stage "Applied skin: $($status.id). The launcher is exiting."
} catch {
    Write-Error "[CodexSkinSwitcher] $($_.Exception.Message)"
    exit 1
}
