# VL.OCIO NuGet Package Build Script
# Prerequisites: Node.js, .NET 8 SDK, nuget CLI

param(
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== VL.OCIO Package Build ===" -ForegroundColor Cyan
Write-Host "Repository root: $RepoRoot"
Write-Host "Configuration: $Configuration"
Write-Host ""

# Step 1: Build C# project (this also builds the web UI via MSBuild target)
Write-Host "--- Building C# project (includes web UI build) ---" -ForegroundColor Yellow
dotnet build "$RepoRoot\src\VL.OCIO.csproj" -c $Configuration
if ($LASTEXITCODE -ne 0) {
    Write-Error "C# build failed"
    exit 1
}
Write-Host "Build succeeded." -ForegroundColor Green
Write-Host ""

# Step 2: Verify embedded resources
Write-Host "--- Verifying embedded resources ---" -ForegroundColor Yellow
$dllPath = "$RepoRoot\lib\net8.0-windows7.0\VL.OCIO.dll"
if (-not (Test-Path $dllPath)) {
    Write-Error "DLL not found at $dllPath"
    exit 1
}
$asm = [System.Reflection.Assembly]::LoadFrom($dllPath)
$resources = $asm.GetManifestResourceNames() | Where-Object { $_ -like "*ui_dist*" }
Write-Host "Embedded UI resources: $($resources.Count)"
foreach ($r in $resources) { Write-Host "  $r" }
if ($resources.Count -eq 0) {
    Write-Error "No embedded UI resources found in DLL!"
    exit 1
}
Write-Host "Embedded resources OK." -ForegroundColor Green
Write-Host ""

# Step 3: Pack NuGet package
Write-Host "--- Packing NuGet package ---" -ForegroundColor Yellow
$nuspecPath = "$RepoRoot\deployment\VL.OCIO.nuspec"
$outputDir = "$RepoRoot\deployment"
nuget pack $nuspecPath -OutputDirectory $outputDir -BasePath $RepoRoot\deployment
if ($LASTEXITCODE -ne 0) {
    Write-Error "NuGet pack failed"
    exit 1
}

$nupkg = Get-ChildItem "$outputDir\VL.OCIO.*.nupkg" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ""
Write-Host "=== Package created: $($nupkg.Name) ===" -ForegroundColor Green
Write-Host "Size: $([math]::Round($nupkg.Length / 1KB, 1)) KB"
Write-Host "Path: $($nupkg.FullName)"
