$PackageDir = $PSScriptRoot
$RepoDir = (Resolve-Path "$PSScriptRoot\..").Path
$HelpDir = "$PackageDir\help"
Start-Process "C:\Program Files\vvvv\vvvv_gamma_7.0-win-x64\vvvv.exe" -WorkingDirectory $HelpDir -ArgumentList "`"$HelpDir\HowTo Apply OCIO Colorspace from Config File.vl`" --package-repositories `"$RepoDir`" --editable-packages `"VL.OCIO`""
