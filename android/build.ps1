param(
    [string]$SdkRoot = "",
    [string]$JdkRoot = "",
    [string]$Keystore = "",
    [string]$KsPass = $env:NANO_KS_PASS,
    [string]$KeyAlias = "nano",
    [string]$KeyPass = $env:NANO_KEY_PASS,
    [string]$WebRoot = "",
    [int]$VersionCode = 0,
    [string]$VersionName = ""
)

$ErrorActionPreference = "Continue"

if ($WebRoot) {
    $ProjectRoot = (Resolve-Path $WebRoot).Path
} else {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

# aapt2 在 Windows 上不能稳定处理中文路径，统一复制到纯英文临时目录构建。
$WorkRoot = Join-Path $env:TEMP "nano-apk-build"
$WorkAndroid = Join-Path $WorkRoot "android"
$BuildDir = Join-Path $WorkAndroid "build"

function Find-Sdk {
    param([string]$Hint)
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    if ($env:ANDROID_SDK_ROOT) { $candidates += $env:ANDROID_SDK_ROOT }
    if ($env:ANDROID_HOME) { $candidates += $env:ANDROID_HOME }
    $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    $candidates += "C:\Android\Sdk"
    $candidates += "C:\Program Files\Android\Sdk"
    $candidates += "D:\Android\Sdk"
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c "platforms\android-35\android.jar"))) { return $c }
    }
    throw "找不到 Android SDK（需要 platforms;android-35）。请设置 ANDROID_SDK_ROOT，或传入 -SdkRoot。"
}

# Windows 版 aapt2 可能把 assets 里的路径写成反斜杠（assets\www\index.html），
# Android 的 AssetManager 只认正斜杠，装到手机上会直接 404（Not Found）。
# 这里按 zip 结构逐个文件名原地替换，长度不变，不影响压缩数据和资源对齐。
function Repair-ZipEntrySeparators {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $eocd = -1
    $min = [Math]::Max(0, $bytes.Length - 22 - 65535)
    for ($i = $bytes.Length - 22; $i -ge $min; $i--) {
        if ($bytes[$i] -eq 0x50 -and $bytes[$i + 1] -eq 0x4B -and
            $bytes[$i + 2] -eq 0x05 -and $bytes[$i + 3] -eq 0x06) {
            $eocd = $i
            break
        }
    }
    if ($eocd -lt 0) { return 0 }
    $count = [int][BitConverter]::ToUInt16($bytes, $eocd + 10)
    $cdOffset = [int][BitConverter]::ToUInt32($bytes, $eocd + 16)
    $p = $cdOffset
    $fixed = 0
    for ($n = 0; $n -lt $count; $n++) {
        if (!($bytes[$p] -eq 0x50 -and $bytes[$p + 1] -eq 0x4B -and
              $bytes[$p + 2] -eq 0x01 -and $bytes[$p + 3] -eq 0x02)) { break }
        $nameLen = [int][BitConverter]::ToUInt16($bytes, $p + 28)
        $extraLen = [int][BitConverter]::ToUInt16($bytes, $p + 30)
        $commentLen = [int][BitConverter]::ToUInt16($bytes, $p + 32)
        $localOffset = [int][BitConverter]::ToUInt32($bytes, $p + 42)
        $nameStart = $p + 46
        for ($j = 0; $j -lt $nameLen; $j++) {
            if ($bytes[$nameStart + $j] -eq 0x5C) {
                $bytes[$nameStart + $j] = 0x2F
                $fixed++
            }
        }
        if ($bytes[$localOffset] -eq 0x50 -and $bytes[$localOffset + 1] -eq 0x4B -and
            $bytes[$localOffset + 2] -eq 0x03 -and $bytes[$localOffset + 3] -eq 0x04) {
            $localNameLen = [int][BitConverter]::ToUInt16($bytes, $localOffset + 26)
            $limit = [Math]::Min($localNameLen, $nameLen)
            for ($j = 0; $j -lt $limit; $j++) {
                if ($bytes[$localOffset + 30 + $j] -eq 0x5C) {
                    $bytes[$localOffset + 30 + $j] = 0x2F
                    $fixed++
                }
            }
        }
        $p = $nameStart + $nameLen + $extraLen + $commentLen
    }
    if ($fixed -gt 0) {
        [System.IO.File]::WriteAllBytes($Path, $bytes)
    }
    return $fixed
}

function Find-Jdk {
    param([string]$Hint)
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
    $candidates += (Get-ChildItem "C:\Program Files\Microsoft" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "jdk-17*" } | ForEach-Object { $_.FullName })
    $candidates += (Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "jdk-17*" } | ForEach-Object { $_.FullName })
    $candidates += (Get-ChildItem "C:\Program Files\Java" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "jdk-17*" } | ForEach-Object { $_.FullName })
    $candidates += "C:\Program Files\Android\Android Studio\jbr"
    $candidates += "C:\Program Files\Android\Android Studio\jre"
    $candidates += "D:\Android\jdk17"
    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c "bin\javac.exe"))) { return $c }
    }
    throw "找不到 JDK 17。请设置 JAVA_HOME，或传入 -JdkRoot。"
}

$SdkRoot = Find-Sdk $SdkRoot
$JdkRoot = Find-Jdk $JdkRoot
$env:JAVA_HOME = $JdkRoot
$env:Path = (Join-Path $JdkRoot "bin") + ";" + $env:Path

$BuildTools = Join-Path $SdkRoot "build-tools\35.0.0"
$AndroidJar = Join-Path $SdkRoot "platforms\android-35\android.jar"
$aapt2 = Join-Path $BuildTools "aapt2.exe"
$d8 = Join-Path $BuildTools "d8.bat"
$zipalign = Join-Path $BuildTools "zipalign.exe"
$apksigner = Join-Path $BuildTools "apksigner.bat"
$javac = Join-Path $JdkRoot "bin\javac.exe"
$jar = Join-Path $JdkRoot "bin\jar.exe"

foreach ($tool in @($aapt2, $d8, $zipalign, $apksigner, $javac, $jar, $AndroidJar)) {
    if (!(Test-Path $tool)) { throw "缺少构建工具：$tool" }
}

if (!$Keystore) {
    $Keystore = Join-Path $ProjectRoot "apk\signing\signing.keystore"
}
if (!(Test-Path $Keystore)) {
    throw "找不到签名文件：$Keystore。请传入 -Keystore，或把签名文件放到 apk/signing/signing.keystore。"
}
if (!$KsPass) { throw "缺少签名库密码。请设置环境变量 NANO_KS_PASS，或传入 -KsPass。" }
if (!$KeyPass) { $KeyPass = $KsPass }

Write-Host "SDK:    $SdkRoot"
Write-Host "JDK:    $JdkRoot"
Write-Host "Keystore: $Keystore"

if (Test-Path $WorkRoot) { Remove-Item -Recurse -Force $WorkRoot }
New-Item -ItemType Directory -Force -Path $WorkAndroid | Out-Null
Get-ChildItem $PSScriptRoot -Force |
    Where-Object { $_.Name -ne "build" } |
    ForEach-Object {
        Copy-Item $_.FullName (Join-Path $WorkAndroid $_.Name) -Recurse -Force
    }

$KeystoreWork = Join-Path $WorkRoot "signing.keystore"
Copy-Item $Keystore $KeystoreWork -Force

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
$assetsRoot = Join-Path $BuildDir "assets"
$www = Join-Path $assetsRoot "www"
New-Item -ItemType Directory -Force -Path $www | Out-Null

Write-Host "复制网页资源…"
$rootFiles = @(
    "index.html", "common.css", "bg.js", "swipe-back.js", "manifest.json", "sw.js"
)
foreach ($f in $rootFiles) {
    $src = Join-Path $ProjectRoot $f
    if (!(Test-Path $src)) { throw "缺少网页文件：$src" }
    Copy-Item $src (Join-Path $www $f) -Force
}
foreach ($dir in @("js", "css", "html", "icons", "images", "docs")) {
    $src = Join-Path $ProjectRoot $dir
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $www $dir) -Recurse -Force
    }
}

# 不把安装包自身再打进安装包
$apkDir = Join-Path $www "apk"
if (Test-Path $apkDir) { Remove-Item -Recurse -Force $apkDir }

# aapt2 在 Windows 上无法处理非 ASCII 资源名；这些独立页面/主题文件没有被主应用引用
Get-ChildItem $www -Recurse -File |
    Where-Object { $_.Name -match '[^\x00-\x7F]' } |
    Remove-Item -Force

Write-Host "编译资源…"
& $aapt2 compile --dir (Join-Path $WorkAndroid "res") -o (Join-Path $BuildDir "res.zip")
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile 失败" }

Write-Host "链接 APK…"
$linkArgs = @(
    "-o", (Join-Path $BuildDir "base.apk"),
    "-I", $AndroidJar,
    "--manifest", (Join-Path $WorkAndroid "AndroidManifest.xml"),
    "-R", (Join-Path $BuildDir "res.zip"),
    "-A", $assetsRoot,
    "--auto-add-overlay"
)
if ($VersionCode -gt 0 -or $VersionName) { $linkArgs += "--replace-version" }
if ($VersionCode -gt 0) { $linkArgs += @("--version-code", [string]$VersionCode) }
if ($VersionName) { $linkArgs += @("--version-name", $VersionName) }
& $aapt2 link @linkArgs
if ($LASTEXITCODE -ne 0) { throw "aapt2 link 失败" }

Write-Host "编译 Java…"
$classesDir = Join-Path $BuildDir "classes"
New-Item -ItemType Directory -Force -Path $classesDir | Out-Null
$sources = @(Get-ChildItem (Join-Path $WorkAndroid "src") -Recurse -File -Filter *.java |
    ForEach-Object { $_.FullName })
$javacErr = Join-Path $BuildDir "javac.err"
& $javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -Xlint:-deprecation `
    -classpath $AndroidJar -d $classesDir $sources 2> $javacErr
if ($LASTEXITCODE -ne 0) {
    if (Test-Path $javacErr) { Get-Content $javacErr | ForEach-Object { Write-Host $_ } }
    throw "javac 失败"
}

Write-Host "生成 dex…"
$dexDir = Join-Path $BuildDir "dex"
New-Item -ItemType Directory -Force -Path $dexDir | Out-Null
$classFiles = @(Get-ChildItem $classesDir -Recurse -File -Filter *.class |
    ForEach-Object { $_.FullName })
& $d8 --release --min-api 24 --lib $AndroidJar --output $dexDir $classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 失败" }

Write-Host "打包 classes.dex…"
Push-Location $dexDir
try {
    & $jar uf (Join-Path $BuildDir "base.apk") "classes.dex"
    if ($LASTEXITCODE -ne 0) { throw "写入 classes.dex 失败" }
} finally {
    Pop-Location
}

Write-Host "修正资源路径分隔符…"
$fixedNames = Repair-ZipEntrySeparators (Join-Path $BuildDir "base.apk")
if ($fixedNames -gt 0) {
    Write-Host "  已把 $fixedNames 处反斜杠改成正斜杠（否则 Android 会报 Not Found）"
} else {
    Write-Host "  资源路径正常，无需修改"
}

# 构建后自检：只要还有反斜杠路径，或缺少入口页，就直接失败，避免再产出“打开 404”的 APK。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$checkZip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $BuildDir "base.apk"))
try {
    $badEntries = @($checkZip.Entries | Where-Object { $_.FullName -match '\\' })
    $hasIndex = @($checkZip.Entries | Where-Object { $_.FullName -eq 'assets/www/index.html' }).Count -gt 0
} finally {
    $checkZip.Dispose()
}
if ($badEntries.Count -gt 0) {
    throw "APK 仍有 $($badEntries.Count) 个反斜杠路径，Android 会 404。请检查 aapt2 版本或 assets 复制方式。"
}
if (!$hasIndex) {
    throw "APK 缺少 assets/www/index.html，入口页没有被正确打包。"
}
Write-Host "  校验通过：assets/www/index.html 存在，路径全部为正斜杠"

Write-Host "对齐…"
& $zipalign -f -p 4 (Join-Path $BuildDir "base.apk") (Join-Path $BuildDir "aligned.apk")
if ($LASTEXITCODE -ne 0) { throw "zipalign 失败" }

Write-Host "签名…"
$outApk = Join-Path $BuildDir "nano.apk"
& $apksigner sign `
    --ks $KeystoreWork `
    --ks-key-alias $KeyAlias `
    --ks-pass ("pass:" + $KsPass) `
    --key-pass ("pass:" + $KeyPass) `
    --out $outApk `
    (Join-Path $BuildDir "aligned.apk")
if ($LASTEXITCODE -ne 0) { throw "apksigner 签名失败" }

Write-Host "校验签名…"
& $apksigner verify --verbose --print-certs $outApk
if ($LASTEXITCODE -ne 0) { throw "APK 签名校验失败" }

$targetDir = Join-Path $ProjectRoot "apk"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$target = Join-Path $targetDir "nano.apk"
Copy-Item $outApk $target -Force
$size = [math]::Round((Get-Item $target).Length / 1MB, 2)
Write-Host ""
Write-Host "完成：$target ($size MB)"
