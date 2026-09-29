param([string]$SignedXpi, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $package.version) { throw 'Manifest and package versions differ.' }
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected package version.' }
$outputRoot = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $projectRoot "release/$($manifest.version)" }
if ($SignedXpi -and -not (Test-Path -LiteralPath $SignedXpi -PathType Leaf)) { throw 'Signed XPI does not exist.' }
if (Test-Path -LiteralPath $outputRoot) { throw "Output already exists: $outputRoot. Preserve it before building again." }
$runtimeRoot = Join-Path $outputRoot 'runtime'
[IO.Directory]::CreateDirectory($runtimeRoot) | Out-Null
$runtimeItems = @('manifest.json', 'background.js', 'content', 'popup', 'print', 'shared', 'icons', 'LICENSE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md')
foreach ($item in $runtimeItems) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination $runtimeRoot -Recurse
}

function New-PackageZip([string]$Base, [string[]]$Items, [string]$Destination) {
    $files = @($Items | ForEach-Object {
        $source = Get-Item -LiteralPath (Join-Path $Base $_) -Force
        if ($source.PSIsContainer) { Get-ChildItem -LiteralPath $source.FullName -Recurse -File -Force }
        else { $source }
    } | Sort-Object FullName -Unique)
    $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew)
    $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($Base.Length + 1).Replace('\', '/')
            $entry = $zip.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $inputStream = $file.OpenRead()
            $entryStream = $entry.Open()
            try { $inputStream.CopyTo($entryStream) }
            finally { $entryStream.Dispose(); $inputStream.Dispose() }
        }
    } finally { $zip.Dispose(); $stream.Dispose() }
}

$prefix = "Dialogue-Export-v$($manifest.version)"
$runtimeZip = Join-Path $outputRoot "$prefix.zip"
New-PackageZip $runtimeRoot $runtimeItems $runtimeZip
if ($SignedXpi) { Copy-Item -LiteralPath $SignedXpi -Destination (Join-Path $outputRoot "$prefix-signed.xpi") }
else { Copy-Item -LiteralPath $runtimeZip -Destination (Join-Path $outputRoot "$prefix-unsigned.xpi") }
$sourceItems = $runtimeItems + @('README.md', 'CHANGELOG.md', 'SECURITY.md', 'package.json', '.gitignore', 'docs', 'tests', 'scripts')
New-PackageZip $projectRoot $sourceItems (Join-Path $outputRoot "$prefix-source.zip")
$hashes = Get-ChildItem -LiteralPath $outputRoot -File | Sort-Object Name | ForEach-Object {
    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"
}
[IO.File]::WriteAllLines((Join-Path $outputRoot 'SHA256SUMS.txt'), $hashes, [Text.UTF8Encoding]::new($false))
Get-ChildItem -LiteralPath $outputRoot -File | Select-Object Name, Length
