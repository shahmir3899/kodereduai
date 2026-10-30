# Builds the Education AI Android APK on this PC (no EAS, no cloud).
# Start it by double-clicking build-apk.bat. Arguments (all optional):
#   check        look at everything and report, change nothing, build nothing
#   nogit        skip every git step (commit, merge, push)
#   clean        force a fresh "expo prebuild" even if nothing changed
#   api=<url>    API the app talks to (default: the Render Singapore server)
#
# What it never does: force push, reset --hard, delete a branch, or change git history. Any
# problem stops the run and leaves the repository as it was. ASCII only: Windows PowerShell 5.1
# misreads a script file that has other characters and no BOM.

$ErrorActionPreference = 'Continue'
$env:GIT_TERMINAL_PROMPT = '0'

$MobileDir = $PSScriptRoot
$AndroidDir = Join-Path $MobileDir 'android'
$OutDir = Join-Path $MobileDir 'build-output'
$LogDir = Join-Path $MobileDir 'build-logs'
$LockFile = Join-Path $LogDir '.lock'
$StampFile = Join-Path $AndroidDir '.build-stamp'
$ApkBuilt = Join-Path $AndroidDir 'app\build\outputs\apk\release\app-release.apk'

$CheckOnly = $args -contains 'check'
$NoGit = $args -contains 'nogit'
$ForcePrebuild = $args -contains 'clean'
$ApiUrl = 'https://personal-gateway-sg.onrender.com/educationai'
foreach ($a in $args) { if ($a -like 'api=*') { $ApiUrl = $a.Substring(4) } }

$PackageName = 'pk.educationai.app'
$NdkVersion = '27.1.12297006'
$PlatformApi = 'android-36'
$MinFreeGb = 10
$MinApkMb = 30
$KeepApks = 5

$script:Warnings = @()
$script:StepNo = 0

function Step($title) { $script:StepNo++; Write-Host ''; Write-Host ("[{0}] {1}" -f $script:StepNo, $title) -ForegroundColor Cyan }
function Info($msg) { Write-Host ("    " + $msg) }
function Ok($msg) { Write-Host ("    OK   " + $msg) -ForegroundColor Green }
function Warn($msg) { $script:Warnings += $msg; Write-Host ("    WARN " + $msg) -ForegroundColor Yellow }
function Stop-Build($msg) { throw ("STOP: " + $msg) }

function AskYesNo($question) {
    while ($true) {
        $answer = (Read-Host ("    " + $question + " [Y/N]")).Trim().ToLower()
        if ($answer -eq 'y' -or $answer -eq 'yes') { return $true }
        if ($answer -eq 'n' -or $answer -eq 'no') { return $false }
    }
}

# Runs git quietly in the repository and returns its output lines; the exit code is in $script:GitExit.
function GitQ {
    $out = & git -C $script:RepoRoot @args 2>$null
    $script:GitExit = $LASTEXITCODE
    return $out
}

function Native-Version($cmd) {
    $line = (& cmd /c "$cmd 2>&1" | Select-Object -First 1)
    return "$line"
}

try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $LogFile = Join-Path $LogDir ("apk-" + $stamp + ".log")
    Start-Transcript -Path $LogFile | Out-Null
    $startedAt = Get-Date

    Write-Host '=== Education AI: build APK on this PC ===' -ForegroundColor White
    if ($CheckOnly) { Write-Host 'CHECK MODE: nothing will be changed or built.' -ForegroundColor Yellow }
    if ($NoGit) { Write-Host 'nogit: every git step is skipped.' -ForegroundColor Yellow }
    Info ("Log: " + $LogFile)

    # ---------------------------------------------------------------- 1. tools and machine
    Step 'Tools and machine'

    if (Test-Path $LockFile) {
        $other = (Get-Content $LockFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($other -and (Get-Process -Id ([int]$other) -ErrorAction SilentlyContinue)) {
            Stop-Build ("Another build is already running (process " + $other + "). Wait for it, or close that window.")
        }
        Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    }
    if (-not $CheckOnly) { Set-Content -Path $LockFile -Value $PID -Encoding ascii }

    foreach ($tool in 'git', 'node', 'npm') {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-Build ("'" + $tool + "' is not installed or not on PATH.") }
    }
    Ok ("git, node " + (Native-Version 'node --version') + ", npm")

    $jdk = $null
    foreach ($candidate in @($env:JAVA_HOME, 'C:\Program Files\Android\Android Studio\jbr', 'C:\Program Files\Java\jdk-17', 'C:\Program Files\Java\jdk-21')) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'bin\java.exe'))) { $jdk = $candidate; break }
    }
    if (-not $jdk) { Stop-Build 'No JDK found. Install Android Studio (it ships one) or JDK 17, or set JAVA_HOME.' }
    $javaLine = Native-Version ('"' + (Join-Path $jdk 'bin\java.exe') + '" -version')
    if ($javaLine -match 'version "(\d+)') {
        $javaMajor = [int]$Matches[1]
        if ($javaMajor -lt 17 -or $javaMajor -gt 21) { Stop-Build ("JDK " + $javaMajor + " found at " + $jdk + ". React Native 0.81 builds with JDK 17 to 21.") }
    }
    $env:JAVA_HOME = $jdk
    Ok ("JDK: " + $jdk)

    $sdk = $null
    foreach ($candidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'))) {
        if ($candidate -and (Test-Path (Join-Path $candidate ('platforms\' + $PlatformApi)))) { $sdk = $candidate; break }
    }
    if (-not $sdk) { Stop-Build ("Android SDK with platform " + $PlatformApi + " not found. In Android Studio, open SDK Manager and install it.") }
    if (-not (Test-Path (Join-Path $sdk ('ndk\' + $NdkVersion)))) { Stop-Build ("NDK " + $NdkVersion + " is missing. In Android Studio: SDK Manager, SDK Tools, NDK (Side by side), tick Show Package Details, install " + $NdkVersion + ".") }
    $buildToolsRoot = Join-Path $sdk 'build-tools'
    $buildTools = Get-ChildItem $buildToolsRoot -Directory -ErrorAction SilentlyContinue | Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } -ErrorAction SilentlyContinue | Select-Object -Last 1
    if (-not $buildTools) { Stop-Build 'No Android build-tools installed (SDK Manager, SDK Tools).' }
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    Ok ("Android SDK: " + $sdk + " (platform " + $PlatformApi + ", NDK " + $NdkVersion + ", build-tools " + $buildTools.Name + ")")

    $freeGb = [math]::Round((Get-PSDrive -Name $MobileDir.Substring(0, 1)).Free / 1GB, 1)
    if ($freeGb -lt $MinFreeGb) { Stop-Build ("Only " + $freeGb + " GB free on drive " + $MobileDir.Substring(0, 1) + ". A build needs about " + $MinFreeGb + " GB.") }
    Ok ($freeGb.ToString() + " GB free")
    if ($MobileDir.Length -gt 90) { Warn ("This folder path is " + $MobileDir.Length + " characters long. Windows can fail on very long paths during the native build step.") }

    # ---------------------------------------------------------------- 2. git state
    $Branch = ''
    $Commit = 'nogit'
    $Dirty = $false
    if ($NoGit) {
        Step 'Git (skipped)'
        Info 'nogit given: no commit, merge or push.'
    } else {
        Step 'Git: state'
        $script:RepoRoot = (& git -C $MobileDir rev-parse --show-toplevel 2>$null)
        if (-not $script:RepoRoot) { Stop-Build 'This folder is not inside a git repository (use build-apk.bat nogit to build anyway).' }
        $script:RepoRoot = "$script:RepoRoot".Trim()
        $prefix = "$(& git -C $MobileDir rev-parse --show-prefix 2>$null)".Trim()

        $gitDir = "$(GitQ rev-parse --git-dir)".Trim()
        if (-not [System.IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $script:RepoRoot $gitDir }
        foreach ($marker in 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply') {
            if (Test-Path (Join-Path $gitDir $marker)) { Stop-Build ("A git operation is half done (" + $marker + "). Finish or abort it first, for example: git merge --abort, git rebase --abort.") }
        }
        $unmerged = @(GitQ ls-files -u | ForEach-Object { ($_ -split "`t")[-1] } | Sort-Object -Unique)
        if ($unmerged.Count -gt 0) { Stop-Build ("Files with unresolved merge conflicts:`n      " + ($unmerged -join "`n      ")) }

        $markerHits = @(& git -C $script:RepoRoot grep --untracked --exclude-standard -n -I -E '^(<<<<<<< |>>>>>>> )' -- ($prefix + '*.ts') ($prefix + '*.tsx') ($prefix + '*.js') ($prefix + '*.json') 2>$null)
        if ($markerHits.Count -gt 0) { Stop-Build ("Merge conflict markers left in the code:`n      " + (($markerHits | Select-Object -First 10) -join "`n      ")) }
        Ok 'no half-done merge, no conflicted files, no conflict markers'

        $Branch = "$(GitQ symbolic-ref --short -q HEAD)".Trim()
        $Commit = "$(GitQ rev-parse --short HEAD)".Trim()
        if ($Branch) { Ok ("Branch " + $Branch + " at " + $Commit) } else { Warn ("Detached HEAD at " + $Commit + ". Merge and push are skipped.") }

        $hasOrigin = [bool](GitQ remote | Where-Object { $_ -eq 'origin' })
        if ($hasOrigin) {
            & git -C $script:RepoRoot fetch --quiet origin 2>$null
            if ($LASTEXITCODE -ne 0) { Warn 'Could not reach the remote (offline or no access). Using what is already downloaded.' }
        } else {
            Warn 'No remote called origin.'
        }

        $MainRef = $null
        foreach ($candidate in 'refs/remotes/origin/main', 'refs/heads/main', 'refs/remotes/origin/master', 'refs/heads/master') {
            GitQ rev-parse --verify --quiet $candidate | Out-Null
            if ($script:GitExit -eq 0) { $MainRef = ($candidate -replace '^refs/(remotes|heads)/', ''); break }
        }

        $status = @(GitQ status --porcelain)
        $Dirty = $status.Count -gt 0
        $upstream = "$(GitQ rev-parse --abbrev-ref --symbolic-full-name '@{u}')".Trim()
        if ($script:GitExit -ne 0) { $upstream = '' }
        $behind = 0; $ahead = 0
        if ($upstream) {
            $behind = [int]"$(GitQ rev-list --count 'HEAD..@{u}')"
            $ahead = [int]"$(GitQ rev-list --count '@{u}..HEAD')"
        }
        $behindMain = 0
        if ($MainRef -and $Branch -and ($MainRef -ne $Branch) -and ($MainRef -ne ('origin/' + $Branch))) {
            $behindMain = [int]"$(GitQ rev-list --count ('HEAD..' + $MainRef))"
        }
        Info ("Uncommitted files: " + $status.Count)
        if ($upstream) { Info ("Against " + $upstream + ": ahead " + $ahead + ", behind " + $behind) } elseif ($Branch) { Info 'No upstream branch set.' }
        if ($MainRef -and $Branch) { Info ("Behind " + $MainRef + ": " + $behindMain + " commit(s)") }

        if ($CheckOnly) {
            Info 'Check mode: not committing, merging or pushing.'
        } else {
            # ------------------------------------------------------------ 3. commit
            Step 'Git: commit'
            if (-not $Dirty) {
                Ok 'nothing to commit'
            } else {
                Info ("Changed files (" + $status.Count + "):")
                $status | Select-Object -First 60 | ForEach-Object { Info ("  " + $_) }
                if ($status.Count -gt 60) { Info ("  ... and " + ($status.Count - 60) + " more") }
                GitQ diff --stat HEAD | Select-Object -Last 1 | ForEach-Object { Info $_ }

                $sensitive = @($status | ForEach-Object { $_.Substring(3) } | Where-Object { $_ -match '(^|/)\.env($|\.)|\.(jks|keystore|pem|p12|pfx|key)$|settings\.local\.json$|credential|secret|id_rsa|service-account' })
                if ($sensitive.Count -gt 0) { Stop-Build ("These changed files look like secrets and will not be committed by this script:`n      " + ($sensitive -join "`n      ") + "`n      Move them out or add them to .gitignore, then run again.") }

                if (AskYesNo ("Commit all " + $status.Count + " changed files?")) {
                    $message = (Read-Host '    Commit message (Enter = default)').Trim() -replace '"', ''
                    if (-not $message) { $message = "WIP: mobile build " + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
                    & git -C $script:RepoRoot add -A
                    if ($LASTEXITCODE -ne 0) { Stop-Build 'git add failed.' }
                    $leaks = @()
                    foreach ($pattern in 'postgres(ql)?://[^\s:@/]+:[^\s@/]+@', '-----BEGIN [A-Z ]*PRIVATE KEY-----', 'AKIA[0-9A-Z]{16}', 'gsk_[A-Za-z0-9]{20,}', 'sk-[A-Za-z0-9]{32,}') {
                        $files = @(GitQ diff --cached -U0 --name-only ('-G' + $pattern))
                        if ($files.Count -gt 0) { $leaks += ($pattern + ' in: ' + ($files -join ', ')) }
                    }
                    if ($leaks.Count -gt 0) {
                        & git -C $script:RepoRoot reset -q
                        Stop-Build ("Something that looks like a secret is in the changes, so nothing was committed (files were unstaged again):`n      " + ($leaks -join "`n      "))
                    }
                    & git -C $script:RepoRoot commit -m $message
                    if ($LASTEXITCODE -ne 0) { Stop-Build 'git commit failed (a hook may have refused it). Nothing else was changed.' }
                    $Commit = "$(GitQ rev-parse --short HEAD)".Trim()
                    $Dirty = @(GitQ status --porcelain).Count -gt 0
                    Ok ("committed " + $Commit)
                } else {
                    Warn 'Left uncommitted. The APK is built from the files as they are and is marked _dirty.'
                }
            }

            # ------------------------------------------------------------ 4. update from remote
            Step 'Git: bring the branch up to date'
            if (-not $Branch) {
                Info 'Detached HEAD: skipped.'
            } elseif ($Dirty) {
                Warn 'Uncommitted changes, so no merge was attempted (a merge needs a clean tree).'
            } else {
                if ($upstream) {
                    $behind = [int]"$(GitQ rev-list --count 'HEAD..@{u}')"
                    $ahead = [int]"$(GitQ rev-list --count '@{u}..HEAD')"
                    if ($behind -gt 0 -and $ahead -gt 0) {
                        Stop-Build ("Your branch and " + $upstream + " have both moved (ahead " + $ahead + ", behind " + $behind + "). Sort that out by hand first, then run again.")
                    } elseif ($behind -gt 0) {
                        if (AskYesNo ($upstream + " has " + $behind + " newer commit(s). Fast-forward your branch to it?")) {
                            & git -C $script:RepoRoot merge --ff-only '@{u}'
                            if ($LASTEXITCODE -ne 0) { Stop-Build 'Fast-forward failed. Nothing was changed.' }
                            Ok 'fast-forwarded'
                        } else {
                            Warn ("Branch is " + $behind + " commit(s) behind " + $upstream + ".")
                        }
                    }
                }
                if (-not $MainRef) {
                    Warn 'No main branch found to merge from.'
                } elseif ($MainRef -eq $Branch -or $MainRef -eq ('origin/' + $Branch)) {
                    Ok ("You are on " + $Branch + ": nothing to merge in.")
                } else {
                    $behindMain = [int]"$(GitQ rev-list --count ('HEAD..' + $MainRef))"
                    if ($behindMain -eq 0) {
                        Ok ("already contains everything in " + $MainRef)
                    } else {
                        Info ("Merging " + $MainRef + " (" + $behindMain + " new commit(s)) into " + $Branch + " ...")
                        & git -C $script:RepoRoot merge $MainRef --no-edit
                        if ($LASTEXITCODE -ne 0) {
                            $conflicted = @(GitQ diff --name-only --diff-filter=U)
                            & git -C $script:RepoRoot merge --abort 2>$null
                            Stop-Build ("Merging " + $MainRef + " into " + $Branch + " has conflicts, so it was aborted and your branch is exactly as it was.`n      Conflicting files:`n      " + ($conflicted -join "`n      ") + "`n      Merge by hand, fix the conflicts, then run again.")
                        }
                        $Commit = "$(GitQ rev-parse --short HEAD)".Trim()
                        Ok ("merged " + $MainRef + ", now at " + $Commit)
                        $afterHits = @(& git -C $script:RepoRoot grep --untracked --exclude-standard -n -I -E '^(<<<<<<< |>>>>>>> )' -- ($prefix + '*.ts') ($prefix + '*.tsx') ($prefix + '*.js') ($prefix + '*.json') 2>$null)
                        if ($afterHits.Count -gt 0) { Stop-Build ("The merge left conflict markers in the code:`n      " + (($afterHits | Select-Object -First 10) -join "`n      ")) }
                    }
                }
            }

            # ------------------------------------------------------------ 5. push
            Step 'Git: push'
            if (-not $Branch -or -not $hasOrigin) {
                Info 'Skipped (detached HEAD or no origin).'
            } else {
                $upstream = "$(GitQ rev-parse --abbrev-ref --symbolic-full-name '@{u}')".Trim()
                if ($script:GitExit -ne 0) { $upstream = '' }
                if ($upstream) {
                    $ahead = [int]"$(GitQ rev-list --count '@{u}..HEAD')"
                    if ($ahead -eq 0) {
                        Ok ("nothing to push (in step with " + $upstream + ")")
                    } elseif (AskYesNo ("Push " + $ahead + " commit(s) on " + $Branch + " to " + $upstream + "?")) {
                        & git -C $script:RepoRoot push
                        if ($LASTEXITCODE -ne 0) { Stop-Build 'Push failed or was rejected. Nothing was forced. Fix it by hand and run again.' }
                        Ok 'pushed'
                    } else {
                        Warn 'Not pushed.'
                    }
                } else {
                    if (AskYesNo ("Branch " + $Branch + " is not on the remote yet. Push it to origin/" + $Branch + "?")) {
                        & git -C $script:RepoRoot push -u origin $Branch
                        if ($LASTEXITCODE -ne 0) { Stop-Build 'Push failed or was rejected. Nothing was forced. Fix it by hand and run again.' }
                        Ok 'pushed'
                    } else {
                        Warn 'Not pushed.'
                    }
                }
            }
        }
        $Dirty = @(GitQ status --porcelain).Count -gt 0
    }

    # ---------------------------------------------------------------- 6. dependencies
    Step 'JavaScript dependencies'
    $lockFile = Join-Path $MobileDir 'package-lock.json'
    if (-not (Test-Path $lockFile)) { Stop-Build 'package-lock.json is missing. Restore it (git checkout -- package-lock.json) so the build uses the exact tested package versions.' }
    $nmMarker = Join-Path $MobileDir 'node_modules\.package-lock.json'
    $needInstall = $false
    if (-not (Test-Path (Join-Path $MobileDir 'node_modules'))) {
        $needInstall = $true
        Info 'node_modules is missing.'
    } elseif ((Test-Path $nmMarker) -and ((Get-Item $lockFile).LastWriteTime -gt (Get-Item $nmMarker).LastWriteTime.AddMinutes(1))) {
        Info 'package-lock.json is newer than the installed packages.'
        if ($CheckOnly) { Warn 'Dependencies are out of date (a real run would offer npm ci).' }
        elseif (AskYesNo 'Run npm ci to bring node_modules up to date?') { $needInstall = $true } else { Warn 'Building with the packages as installed.' }
    } else {
        Ok 'node_modules matches package-lock.json'
    }
    if ($needInstall) {
        if ($CheckOnly) {
            Warn 'node_modules is missing (a real run would run npm ci).'
        } else {
            Push-Location $MobileDir
            & npm ci --no-audit --no-fund
            $npmExit = $LASTEXITCODE
            Pop-Location
            if ($npmExit -ne 0) { Stop-Build 'npm ci failed.' }
            Ok 'npm ci done'
        }
    }

    # ---------------------------------------------------------------- 7. server reachable
    Step 'API server'
    try {
        Invoke-WebRequest -Uri $ApiUrl -Method Head -TimeoutSec 25 -UseBasicParsing | Out-Null
        Ok ($ApiUrl + " answers")
    } catch {
        if ($_.Exception.Response) { Ok ($ApiUrl + " answers (HTTP " + [int]$_.Exception.Response.StatusCode + ")") }
        else { Warn ($ApiUrl + " did not answer. The APK still builds; the app will not log in until the server is up.") }
    }

    # ---------------------------------------------------------------- 8. native project
    Step 'Native Android project'
    $env:EXPO_PUBLIC_API_URL = $ApiUrl
    $env:EXPO_PUBLIC_APP_ENV = 'internal'
    $env:EXPO_PUBLIC_ALLOW_INSECURE_HTTP = 'true'
    $env:NODE_ENV = 'production'
    $env:CI = '1'

    $hash = ((@('app.json', 'package.json', 'package-lock.json') | ForEach-Object { (Get-FileHash (Join-Path $MobileDir $_) -Algorithm SHA256).Hash }) -join '-')
    $oldHash = if (Test-Path $StampFile) { (Get-Content $StampFile -ErrorAction SilentlyContinue | Select-Object -First 1) } else { '' }
    $gradleFile = Join-Path $AndroidDir 'app\build.gradle'
    $idOk = (Test-Path $gradleFile) -and ((Get-Content $gradleFile -Raw) -match ('applicationId\s+["' + "'" + ']' + [regex]::Escape($PackageName) + '["' + "'" + ']'))
    $needPrebuild = $ForcePrebuild -or (-not $idOk) -or ($hash -ne $oldHash)
    if ($needPrebuild) {
        $why = if ($ForcePrebuild) { 'requested' } elseif (-not $idOk) { 'android folder missing or for another package' } else { 'app.json or dependencies changed' }
        Info ("Regenerating the android folder (" + $why + "). It is generated and ignored by git.")
    } else {
        Ok 'android folder is current, reusing it'
    }

    if ($CheckOnly) {
        Write-Host ''
        Write-Host 'Check finished. Nothing was changed or built.' -ForegroundColor Green
        if ($script:Warnings.Count -gt 0) { Write-Host ("Warnings: " + $script:Warnings.Count) -ForegroundColor Yellow; $script:Warnings | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow } }
        return
    }

    if ($needPrebuild) {
        Remove-Item $StampFile -Force -ErrorAction SilentlyContinue
        Push-Location $MobileDir
        & npx expo prebuild --platform android --clean --no-install
        $preExit = $LASTEXITCODE
        Pop-Location
        if ($preExit -ne 0) { Stop-Build 'expo prebuild failed.' }
        Set-Content -Path $StampFile -Value $hash -Encoding ascii
        Ok 'prebuild done'
    }
    # Gradle finds the SDK here; a wrong path in this file broke an earlier build.
    Set-Content -Path (Join-Path $AndroidDir 'local.properties') -Value ('sdk.dir=' + ($sdk -replace '\\', '/')) -Encoding ascii

    # ---------------------------------------------------------------- 9. build
    Step 'Gradle release build'
    Info 'The first build takes about 20 minutes; later ones are faster. You can leave it running.'
    Remove-Item $ApkBuilt -Force -ErrorAction SilentlyContinue
    Push-Location $AndroidDir
    & cmd /c '.\gradlew.bat assembleRelease'
    $gradleExit = $LASTEXITCODE
    Pop-Location
    if ($gradleExit -ne 0) { Stop-Build ("Gradle failed (exit " + $gradleExit + "). The reason is above, near the first line that says FAILED or What went wrong. Full log: " + $LogFile) }

    # ---------------------------------------------------------------- 10. check and publish
    Step 'Check the APK'
    if (-not (Test-Path $ApkBuilt)) { Stop-Build 'Gradle said it succeeded but there is no APK.' }
    $apk = Get-Item $ApkBuilt
    if ($apk.LastWriteTime -lt $startedAt) { Stop-Build 'The APK found is older than this run, so it is not the new build.' }
    $sizeMb = [math]::Round($apk.Length / 1MB, 1)
    if ($sizeMb -lt $MinApkMb) { Stop-Build ("The APK is only " + $sizeMb + " MB, which is too small to be right (expected over " + $MinApkMb + " MB).") }
    Ok ($sizeMb.ToString() + " MB")

    $versionName = '1.0.0'; $versionCode = '?'
    $aapt2 = Join-Path $buildTools.FullName 'aapt2.exe'
    if (Test-Path $aapt2) {
        $badging = (& $aapt2 dump badging $apk.FullName 2>$null | Select-Object -First 1)
        if ("$badging" -match "package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'") {
            if ($Matches[1] -ne $PackageName) { Stop-Build ("The APK is for package " + $Matches[1] + ", expected " + $PackageName + ".") }
            $versionCode = $Matches[2]; $versionName = $Matches[3]
            Ok ("package " + $PackageName + ", version " + $versionName + " (code " + $versionCode + ")")
        } else {
            Warn 'Could not read the package name from the APK.'
        }
    } else {
        Warn 'aapt2 not found, so the package name was not checked.'
    }

    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $safeBranch = if ($Branch) { $Branch -replace '[^A-Za-z0-9._-]', '-' } else { 'nobranch' }
    $name = "EducationAI_v" + $versionName + "_" + $safeBranch + "_" + $Commit + $(if ($Dirty) { '_dirty' } else { '' }) + "_" + (Get-Date -Format 'yyyyMMdd-HHmm') + ".apk"
    $final = Join-Path $OutDir $name
    Copy-Item $apk.FullName $final
    Get-ChildItem $OutDir -Filter 'EducationAI_*.apk' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $KeepApks | Remove-Item -Force -ErrorAction SilentlyContinue

    Push-Location $AndroidDir
    & cmd /c '.\gradlew.bat --stop' | Out-Null
    Pop-Location

    $minutes = [math]::Round(((Get-Date) - $startedAt).TotalMinutes, 1)
    Write-Host ''
    Write-Host '=== DONE ===' -ForegroundColor Green
    Write-Host ("APK:      " + $final) -ForegroundColor Green
    Write-Host ("Size:     " + $sizeMb + " MB, built in " + $minutes + " min")
    Write-Host ("Source:   " + $(if ($Branch) { $Branch } else { 'detached' }) + " at " + $Commit + $(if ($Dirty) { ' with UNCOMMITTED changes' } else { '' }))
    Write-Host ("Server:   " + $ApiUrl)
    Write-Host 'Install:  copy it to the phone, or run: adb install -r "<the APK path above>"'
    Write-Host 'Note:     this APK is signed with a debug key. If an EAS-built Education AI is installed, uninstall it first.'
    if ($script:Warnings.Count -gt 0) { Write-Host ''; Write-Host 'Warnings during this run:' -ForegroundColor Yellow; $script:Warnings | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow } }
    Start-Process explorer.exe -ArgumentList ('/select,"' + $final + '"')
}
catch {
    $text = "$($_.Exception.Message)"
    if ($text -like 'STOP: *') { $text = $text.Substring(6) }
    Write-Host ''
    Write-Host 'BUILD STOPPED' -ForegroundColor Red
    Write-Host $text -ForegroundColor Red
    if ($LogFile) { Write-Host ("Log: " + $LogFile) -ForegroundColor Red }
    $script:Failed = $true
}
finally {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
    try { Stop-Transcript | Out-Null } catch { }
}
if ($script:Failed) { exit 1 }
exit 0
