# Erzeugt die App-Icons für Sonnenflug (icons/icon-192.png, icons/icon-512.png).
# Aufruf:  powershell -File tools\make-icons.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = "$PSScriptRoot\..\icons"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

function New-SonnenflugIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Hintergrund: dunkler Himmel mit Verlauf (iOS rundet die Ecken automatisch)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(7, 11, 28),
        [System.Drawing.Color]::FromArgb(24, 28, 70), 90)
    $g.FillRectangle($brush, $rect)

    $S = { param($f) [int]($f * $size) }

    # Sonnen-Glow
    $glow = [System.Drawing.Color]::FromArgb(90, 255, 140, 60)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($glow)),
        (& $S 0.06), (& $S 0.26), (& $S 0.62), (& $S 0.62))
    # Sonne
    $sun = [System.Drawing.Color]::FromArgb(255, 179, 71)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($sun)),
        (& $S 0.14), (& $S 0.36), (& $S 0.46), (& $S 0.46))

    # Flugzeug (Papierflieger-Silhouette, zeigt nach rechts)
    $pts = @(
        (New-Object System.Drawing.PointF((& $S 0.92), (& $S 0.50))),  # Nase
        (New-Object System.Drawing.PointF((& $S 0.34), (& $S 0.18))),  # oberer Flügel
        (New-Object System.Drawing.PointF((& $S 0.48), (& $S 0.50))),  # Rumpfmitte
        (New-Object System.Drawing.PointF((& $S 0.34), (& $S 0.82))),  # unterer Flügel
        (New-Object System.Drawing.PointF((& $S 0.42), (& $S 0.82))),  # untere Flügelhintenkante
        (New-Object System.Drawing.PointF((& $S 0.60), (& $S 0.55))),  # Leitwerk unten
        (New-Object System.Drawing.PointF((& $S 0.60), (& $S 0.45))),  # Leitwerk oben
        (New-Object System.Drawing.PointF((& $S 0.42), (& $S 0.18)))   # obere Flügelhintenkante
    )
    $white = [System.Drawing.Color]::FromArgb(238, 242, 255)
    $g.FillPolygon((New-Object System.Drawing.SolidBrush($white)), $pts)

    $g.Dispose()
    return $bmp
}

# 512er zeichnen, daraus den 192er skalieren (besser Anti-Aliasing)
$big = New-SonnenflugIcon 512
$small = New-Object System.Drawing.Bitmap(192, 192)
$sg = [System.Drawing.Graphics]::FromImage($small)
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$sg.DrawImage($big, 0, 0, 192, 192)
$sg.Dispose()

$big.Save("$outDir\icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
$small.Save("$outDir\icon-192.png", [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose(); $small.Dispose()

Write-Host "Fertig: icons\icon-192.png und icons\icon-512.png"
