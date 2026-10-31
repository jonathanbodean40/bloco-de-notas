param(
    [Parameter(Mandatory=$true)][string]$InputApk,
    [Parameter(Mandatory=$true)][string]$OutputApk
)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'KeepAligner\AndroidSigning'
$tool = Join-Path $root 'build-tools\android-15'
$key = Join-Path $root 'bloco-notas-pro-release.p12'
$secret = Join-Path $root 'signing-password.dpapi'
$aligned = Join-Path $env:TEMP ('NotasPro-' + [guid]::NewGuid().ToString('N') + '-aligned.apk')
if (!(Test-Path $key) -or !(Test-Path $secret)) { throw 'Chave de assinatura local não configurada.' }
if (!(Test-Path $InputApk)) { throw 'APK de entrada não encontrado.' }
if (!(Test-Path (Join-Path $tool 'apksigner.bat'))) { throw 'Android Build Tools locais não encontrados.' }
$secure = Get-Content $secret | ConvertTo-SecureString
$credential = New-Object System.Management.Automation.PSCredential('release', $secure)
$env:KEYSTORE_PASS = $credential.GetNetworkCredential().Password
$env:JAVA_HOME = 'C:\Program Files\Java\jre1.8.0_451'
try {
    & (Join-Path $tool 'zipalign.exe') -f -p 4 $InputApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'Alinhamento do APK falhou.' }
    & (Join-Path $tool 'apksigner.bat') sign --ks $key --ks-type PKCS12 --ks-key-alias bloco-notas-pro --ks-pass env:KEYSTORE_PASS --key-pass env:KEYSTORE_PASS --out $OutputApk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'Assinatura do APK falhou.' }
    & (Join-Path $tool 'apksigner.bat') verify --min-sdk-version 23 --verbose $OutputApk
    if ($LASTEXITCODE -ne 0) { throw 'Verificação de assinatura do APK falhou.' }
    $hash = (Get-FileHash $OutputApk -Algorithm SHA256).Hash
    Write-Output ('SIGNED_APK_SHA256=' + $hash)
} finally {
    Remove-Item Env:\KEYSTORE_PASS -ErrorAction SilentlyContinue
    Remove-Item $aligned -Force -ErrorAction SilentlyContinue
}
