# Pleadly 桌面自动同步监视器
# 每 0.8 秒检查一次 index.html，一旦有变化就复制到桌面并切成本地免费版。
# 等价于「同步Pleadly.bat」的复制 + 免费版切换两步，但全自动，无需手动双击。
$ErrorActionPreference = 'SilentlyContinue'

$repo = 'G:\wwwww\lab\Pleadly-web'
$src  = Join-Path $repo 'index.html'
$dst  = Join-Path $env:USERPROFILE 'Desktop\Pleadly.html'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Sync-Pleadly {
    # 等文件写完再读（被占用说明还在写，重试最多 2 秒）
    $ok = $false
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $fs = [System.IO.File]::Open($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
            $fs.Close()
            $ok = $true
            break
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $ok) { return }

    $c = [System.IO.File]::ReadAllText($src)
    $c = $c.Replace('var FREE_MODE=false;', 'var FREE_MODE=true;')
    [System.IO.File]::WriteAllText($dst, $c, $utf8NoBom)
}

$last = $null
while ($true) {
    if (Test-Path $src) {
        $cur = (Get-Item $src).LastWriteTimeUtc
        if ($cur -ne $last) {
            $last = $cur
            Sync-Pleadly
        }
    }
    Start-Sleep -Milliseconds 800
}
