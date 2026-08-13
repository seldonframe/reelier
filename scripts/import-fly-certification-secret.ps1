[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    "REELIER_GITHUB_TOKEN",
    "REELIER_VERCEL_TOKEN",
    "REELIER_NEON_API_KEY",
    "REELIER_NEON_DATABASE_URL",
    "REELIER_CLOUDFLARE_TOKEN",
    "REELIER_SLACK_TOKEN",
    "REELIER_HUBSPOT_TOKEN"
  )]
  [string]$Name,

  [ValidatePattern("^[a-z0-9][a-z0-9-]{0,62}$")]
  [string]$App = "reelier-cert-cell-maxim"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$flyctl = (Get-Command flyctl -ErrorAction Stop).Source
$secureValue = Read-Host "Enter the value for $Name (input is masked)" -AsSecureString
$bstr = [IntPtr]::Zero
$plain = $null

try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $flyctl
  $startInfo.Arguments = "secrets import --stage --app $App"
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.StandardInputEncoding = [Text.UTF8Encoding]::new($false)

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "flyctl did not start" }
  $process.StandardInput.WriteLine("$Name=$plain")
  $process.StandardInput.Close()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "flyctl secrets import failed with exit code $($process.ExitCode)" }
}
finally {
  $plain = $null
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

Write-Host "Staged $Name for $App. The value was not written to disk or passed as a command argument."
