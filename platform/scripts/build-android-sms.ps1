$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$toolsRoot = Join-Path $sdkRoot 'build-tools\35.0.0'
$androidJar = Join-Path $sdkRoot 'platforms\android-36\android.jar'
$outputRoot = Join-Path $projectRoot 'output\private\android-sms-build'
New-Item -ItemType Directory -Path (Join-Path $outputRoot 'classes'),(Join-Path $outputRoot 'dex') -Force | Out-Null
$sources = Get-ChildItem (Join-Path $projectRoot 'device\android-sms\src') -Recurse -Filter *.java | ForEach-Object FullName
& javac -source 8 -target 8 -classpath $androidJar -d (Join-Path $outputRoot 'classes') $sources
if ($LASTEXITCODE) { throw 'javac failed' }
$classes = Get-ChildItem (Join-Path $outputRoot 'classes') -Recurse -Filter *.class | ForEach-Object FullName
& (Join-Path $toolsRoot 'd8.bat') --lib $androidJar --min-api 26 --output (Join-Path $outputRoot 'dex') $classes
if ($LASTEXITCODE) { throw 'd8 failed' }
& (Join-Path $toolsRoot 'aapt.exe') package -f -M (Join-Path $projectRoot 'device\android-sms\AndroidManifest.xml') -I $androidJar -F (Join-Path $outputRoot 'unsigned.apk')
if ($LASTEXITCODE) { throw 'aapt failed' }
Push-Location (Join-Path $outputRoot 'dex')
try { & (Join-Path $toolsRoot 'aapt.exe') add (Join-Path $outputRoot 'unsigned.apk') classes.dex } finally { Pop-Location }
$keyDirectory = Join-Path $env:USERPROFILE '.starli-device'
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$keyPath = Join-Path $keyDirectory 'sms-bridge-signing.p12'
$previousKey = Join-Path $outputRoot 'bridge-signing.p12'
if (!(Test-Path -LiteralPath $keyPath) -and (Test-Path -LiteralPath $previousKey)) { Copy-Item -LiteralPath $previousKey -Destination $keyPath }
if (!(Test-Path -LiteralPath $keyPath)) { & keytool -genkeypair -keystore $keyPath -storepass starli-local-build -keypass starli-local-build -alias bridge -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=Starli SMS Bridge' }
& (Join-Path $toolsRoot 'zipalign.exe') -f 4 (Join-Path $outputRoot 'unsigned.apk') (Join-Path $outputRoot 'aligned.apk')
& (Join-Path $toolsRoot 'apksigner.bat') sign --ks $keyPath --ks-pass pass:starli-local-build --out (Join-Path $outputRoot 'starli-sms-bridge.apk') (Join-Path $outputRoot 'aligned.apk')
if ($LASTEXITCODE) { throw 'APK signing failed' }
& (Join-Path $toolsRoot 'apksigner.bat') verify (Join-Path $outputRoot 'starli-sms-bridge.apk')
