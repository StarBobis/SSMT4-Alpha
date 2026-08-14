$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$port = 8787
$job = Start-Job -ScriptBlock {
  param($root, $port)
  Set-Location -LiteralPath $root
  & (Join-Path $root 'node_modules/.bin/wrangler.cmd') dev --local --config wrangler.toml --ip 127.0.0.1 --port $port --inspector-port 9230
} -ArgumentList $serviceRoot, $port

try {
  $ready = $false
  $notFoundStatus = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$port/not-found" -UseBasicParsing -TimeoutSec 1
      $notFoundStatus = [int]$probe.StatusCode
      $ready = $true
      break
    } catch {
      if ($_.Exception.Response) {
        $notFoundStatus = [int]$_.Exception.Response.StatusCode
        $ready = $true
        break
      }
      if ($job.State -eq 'Failed') { throw (Receive-Job -Job $job | Out-String) }
    }
  }
  if (-not $ready) {
    $diagnostic = Receive-Job -Job $job -Keep | Out-String
    throw "Local Worker did not become ready within 15 seconds. Job output: $diagnostic"
  }
  if ($notFoundStatus -ne 404) { throw "Expected 404 for unknown route, got $notFoundStatus." }
  "NOT_FOUND_STATUS=$notFoundStatus"

  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$port/v1/submissions" -Method Post -ContentType 'application/json' -Headers @{ 'Idempotency-Key' = 'local-smoke-invalid' } -Body '{"metadata":{"schemaVersion":1,"gamePreset":"unknown"},"archive":{"size":0}}' -UseBasicParsing -TimeoutSec 5 | Out-Null
    throw 'Invalid metadata unexpectedly succeeded.'
  } catch {
    $response = $_.Exception.Response
    if (-not $response) { throw }
    $body = [System.IO.StreamReader]::new($response.GetResponseStream()).ReadToEnd()
    "INVALID_STATUS=$([int]$response.StatusCode) BODY=$body"
  }

  try {
    $scheduled = Invoke-WebRequest -Uri "http://127.0.0.1:$port/cdn-cgi/local/scheduled" -UseBasicParsing -TimeoutSec 10
    "SCHEDULED_STATUS=$($scheduled.StatusCode)"
  } catch {
    $response = $_.Exception.Response
    if (-not $response) { throw }
    "SCHEDULED_STATUS=$([int]$response.StatusCode)"
  }
} finally {
  Stop-Job -Job $job -ErrorAction SilentlyContinue
  Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
}
