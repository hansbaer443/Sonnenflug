# Baut waypoints.js (Navigations-Wegpunkt-Datenbank) für Sonnenflug.
# Quellen (werden automatisch heruntergeladen, falls nicht vorhanden):
#   - earth_fix.dat  (Fixes/Intersections, X-Plane navdata, github.com/mcantsin/x-plane-navdata)
#   - earth_nav.dat  (NDB/VOR/TACAN, gleiche Quelle)
#   - airports.csv   (Flughäfen, ourairports.com/data)
# Aufruf:  powershell -File tools\build-waypoints.ps1

param(
    [string]$NavDir = "$env:TEMP\sonnenflug_nav",
    [string]$OutFile = "$PSScriptRoot\..\waypoints.js"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ci = [System.Globalization.CultureInfo]::InvariantCulture

# --- Downloads falls nötig ---
$files = @{
    "earth_fix.dat" = "https://raw.githubusercontent.com/mcantsin/x-plane-navdata/master/earth_fix.dat"
    "earth_nav.dat" = "https://raw.githubusercontent.com/mcantsin/x-plane-navdata/master/earth_nav.dat"
    "airports.csv"  = "https://ourairports.com/data/airports.csv"
}
New-Item -ItemType Directory -Path $NavDir -Force | Out-Null
foreach ($name in $files.Keys) {
    $dest = Join-Path $NavDir $name
    if (-Not (Test-Path $dest)) {
        Write-Host "Lade $name ..."
        Invoke-WebRequest -Uri $files[$name] -OutFile $dest -UseBasicParsing -TimeoutSec 120
    }
}

$sb = [System.Text.StringBuilder]::new()
$script:addCount = 0

function Add-Record([string]$ident, [string]$typ, [double]$lat, [double]$lon, [string]$name) {
    $ident = $ident.Trim().ToUpper($ci)
    if ($ident -eq "" -or $ident -match '[;"'']') { return }
    $la = [math]::Round($lat, 4).ToString($ci)
    $lo = [math]::Round($lon, 4).ToString($ci)
    $nm = ($name -replace '[;"'']', "").Trim()
    $line = "$ident;$typ;$la;$lo"
    if ($nm -ne "") { $line += ";$nm" }
    [void]$sb.Append($line)
    [void]$sb.Append("\n")
    $script:addCount++
}

# --- 1) Fixes (earth_fix.dat) ---
Write-Host "Verarbeite earth_fix.dat ..."
$n = 0
foreach ($line in [System.IO.File]::ReadLines((Join-Path $NavDir "earth_fix.dat"))) {
    $t = $line -split '\s+', 0, "Regex" | Where-Object { $_ -ne "" }
    if ($t.Count -eq 3) {
        $lat = 0.0; $lon = 0.0
        if ([double]::TryParse($t[0], [System.Globalization.NumberStyles]::Float, $ci, [ref]$lat) -and
            [double]::TryParse($t[1], [System.Globalization.NumberStyles]::Float, $ci, [ref]$lon)) {
            Add-Record $t[2] "F" $lat $lon ""
            $n++
            continue
        }
    }
    if ($line.Trim() -eq "99") { break }
}
Write-Host "  $n Fixes"

# --- 2) Navaids (earth_nav.dat): Typ 2=NDB, 3=VOR, 13=TACAN ---
Write-Host "Verarbeite earth_nav.dat ..."
$n = 0
foreach ($line in [System.IO.File]::ReadLines((Join-Path $NavDir "earth_nav.dat"))) {
    $t = $line -split '\s+', 0, "Regex" | Where-Object { $_ -ne "" }
    if ($t.Count -lt 8) { continue }
    $typCode = $t[0]
    if ($typCode -notin @("2", "3", "13")) { continue }
    $lat = 0.0; $lon = 0.0
    if (-not [double]::TryParse($t[1], [System.Globalization.NumberStyles]::Float, $ci, [ref]$lat)) { continue }
    if (-not [double]::TryParse($t[2], [System.Globalization.NumberStyles]::Float, $ci, [ref]$lon)) { continue }
    $typ = switch ($typCode) { "2" { "N" } "3" { "V" } "13" { "T" } }
    $name = ($t[8..($t.Count - 1)] -join " ") -replace '\s+(NDB|VOR|VOR-DME|VOR\/DME|DVOR|TACAN|DME)$', ""
    Add-Record $t[7] $typ $lat $lon $name
    $n++
}
Write-Host "  $n Navaids"

# --- 3) Flughäfen (airports.csv) ---
Write-Host "Verarbeite airports.csv ..."
$n = 0
Import-Csv (Join-Path $NavDir "airports.csv") | ForEach-Object {
    if ($_.type -notin @("large_airport", "medium_airport", "small_airport", "seaplane_base")) { return }
    $lat = [double]$_.latitude_deg
    $lon = [double]$_.longitude_deg
    $nm = $_.name
    $seen = @{}
    foreach ($ident in @($_.ident, $_.icao_code, $_.iata_code)) {
        $id = ("$ident").Trim().ToUpper($ci)
        if ($id -ne "" -and -not $seen.ContainsKey($id)) {
            $seen[$id] = $true
            Add-Record $id "A" $lat $lon $nm
            $n++
        }
    }
}
Write-Host "  $n Flughafen-Einträge (inkl. ICAO/IATA-Aliasse)"

# --- Ausgabe ---
$header = @"
"Use strict";
// Navigations-Wegpunkt-Datenbank für Sonnenflug.
// Quellen:
//   earth_fix.dat / earth_nav.dat  (X-Plane navdata, AIRAC 2012.08, GPL v3,
//     https://github.com/mcantsin/x-plane-navdata)
//   airports.csv  (OurAirports, Public Domain, https://ourairports.com/data)
// Datensatzformat: IDENT;TYP;LAT;LON[;NAME]
//   TYP: F=Fix/Intersection, V=VOR, N=NDB, T=TACAN, A=Flughafen
// Generiert von tools/build-waypoints.ps1
window.WAYPOINT_DB_RAW = "
"@
[void]$sb.Insert(0, $header)
[void]$sb.Append('";')

$outPath = [System.IO.Path]::GetFullPath($OutFile)
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
$sizeMB = [math]::Round((Get-Item $outPath).Length / 1MB, 2)
Write-Host "Fertig: $outPath ($addCount Einträge, $sizeMB MB)"
