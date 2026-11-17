# Builds Sprout (app, plugin, tools, viewer) and puts a release into release\Sprout-<version>\ plus a zip.
#
#   powershell -ExecutionPolicy Bypass -File tools/package.ps1            # build, then package
#   powershell -ExecutionPolicy Bypass -File tools/package.ps1 -NoBuild   # package what is built
#
# Needs: Visual Studio 2022, CMake, Node.js 20+, and JUCE and Spout2 in external\ (see README).

param(
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# The version comes from the viewer's package.json (keep it equal to project() in CMakeLists.txt).
$version = (Get-Content viewer\package.json -Raw | ConvertFrom-Json).version

if (-not $NoBuild) {
    if (-not (Test-Path external\JUCE) -or -not (Test-Path external\Spout2)) {
        throw 'external\JUCE and external\Spout2 are missing: clone them first (README, Build).'
    }
    if (-not (Test-Path build\CMakeCache.txt)) {
        cmake -S . -B build -G 'Visual Studio 17 2022' -A x64
        if ($LASTEXITCODE -ne 0) { throw 'cmake configure failed' }
    }
    cmake --build build --config Release
    if ($LASTEXITCODE -ne 0) { throw 'C++ build failed' }
    npm --prefix viewer ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    npm --prefix viewer run build
    if ($LASTEXITCODE -ne 0) { throw 'viewer build failed' }
}

$exe = 'build\Release\Sprout.exe'
$plugin = 'build\SproutTap_artefacts\Release\VST3\Sprout Tap.vst3'
$web = 'viewer\dist'
foreach ($p in @($exe, $plugin, "$web\index.html")) {
    if (-not (Test-Path $p)) { throw "Missing ${p}: build first (run without -NoBuild)." }
}

$name = "Sprout-$version"
$out = Join-Path 'release' $name
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null

Copy-Item $exe $out
Copy-Item 'build\Release\fake_tap.exe' $out -ErrorAction SilentlyContinue
# Sprout.exe serves the page from the "web" folder next to it.
Copy-Item $web (Join-Path $out 'web') -Recurse
Copy-Item $plugin $out -Recurse
Copy-Item README.md, CHANGELOG.md, LICENSE, THIRD_PARTY_NOTICES.md $out
New-Item -ItemType Directory -Force (Join-Path $out 'docs') | Out-Null
Copy-Item docs\user-guide.md, docs\architecture.md (Join-Path $out 'docs')
Copy-Item docs\images (Join-Path $out 'docs\images') -Recurse
Copy-Item tap\LICENSE (Join-Path $out 'Sprout Tap.vst3\LICENSE-AGPL-3.0.txt')

@"
Sprout Visualizer $version

1. Copy the "Sprout Tap.vst3" folder to C:\Program Files\Common Files\VST3\ and rescan plugins in your DAW.
2. Put Sprout Tap first on every vocal track (Role: Auto).
3. Run Sprout.exe (keep the "web" folder next to it).
4. In OBS: + > Browser, URL http://localhost:7777/?obs, your canvas size, below the avatar source.
5. Open http://localhost:7777/ in a browser to pick a look and fit it to your avatar.

Full guide: docs\user-guide.md. Sprout.exe and the plugin must come from the same release.
"@ | Set-Content -Encoding utf8 (Join-Path $out 'START HERE.txt')

$zip = Join-Path 'release' "$name.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $out -DestinationPath $zip
Write-Host "Release: $out"
Write-Host "Zip:     $zip"
