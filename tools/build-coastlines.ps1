# Baut coastlines.js (vereinfachte Weltkarte) für Sonnenflug.
# Quelle: Natural Earth 110m Land-Polygone (Public Domain)
#   https://github.com/nvkelso/natural-earth-vector
# Aufruf:  powershell -File tools\build-coastlines.ps1

param(
    [string]$Url = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson",
    [string]$CacheFile = "$env:TEMP\sonnenflug_ne110_land.geojson",
    [string]$OutFile = "$PSScriptRoot\..\coastlines.js"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-Not (Test-Path $CacheFile)) {
    Write-Host "Lade Natural Earth 110m Land ..."
    Invoke-WebRequest -Uri $Url -OutFile $CacheFile -UseBasicParsing -TimeoutSec 120
}

Write-Host "Verarbeite GeoJSON ..."
$geo = Get-Content $CacheFile -Raw -Encoding UTF8 | ConvertFrom-Json

$sb = [System.Text.StringBuilder]::new()
[void]$sb.Append("[")
$ringCount = 0
$pointCount = 0

function Add-Ring($ring) {
    # Ring = Array von [lon, lat]
    if ($ring.Count -lt 4) { return }
    if ($script:ringCount -gt 0) { [void]$script:sb.Append(",") }
    [void]$script:sb.Append("[")
    $first = $true
    foreach ($pt in $ring) {
        if (-not $first) { [void]$script:sb.Append(",") }
        $lon = [math]::Round([double]$pt[0], 2).ToString([System.Globalization.CultureInfo]::InvariantCulture)
        $lat = [math]::Round([double]$pt[1], 2).ToString([System.Globalization.CultureInfo]::InvariantCulture)
        [void]$script:sb.Append("[$lon,$lat]")
        $first = $false
        $script:pointCount++
    }
    [void]$script:sb.Append("]")
    $script:ringCount++
}

foreach ($feature in $geo.features) {
    $g = $feature.geometry
    if ($g.type -eq "Polygon") {
        foreach ($ring in $g.coordinates) { Add-Ring $ring }
    }
    elseif ($g.type -eq "MultiPolygon") {
        foreach ($poly in $g.coordinates) {
            foreach ($ring in $poly) { Add-Ring $ring }
        }
    }
}
[void]$sb.Append("];")

$header = @"
"Use strict";
// Vereinfachte Weltkarte (Landmassen) für Sonnenflug.
// Quelle: Natural Earth 110m Land (Public Domain),
//   https://github.com/nvkelso/natural-earth-vector
// Format: Array von Ringen; Ring = Array von [lon, lat].
// Generiert von tools/build-coastlines.ps1
window.COASTLINES =
"@
[void]$sb.Insert(0, $header)

$outPath = [System.IO.Path]::GetFullPath($OutFile)
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
$sizeKB = [math]::Round((Get-Item $outPath).Length / 1KB, 0)
Write-Host "Fertig: $outPath ($ringCount Ringe, $pointCount Punkte, $sizeKB KB)"
