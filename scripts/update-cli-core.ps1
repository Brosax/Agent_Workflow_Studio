param(
  [string]$CorePath = "vendor/D_RD"
)

$ErrorActionPreference = "Stop"
$resolvedCorePath = Resolve-Path -LiteralPath $CorePath

git -c "safe.directory=$resolvedCorePath" -C $resolvedCorePath pull --ff-only

