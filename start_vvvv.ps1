# Start vvvv with VL.OCIO package
$vvvvPath = "C:\Program Files\vvvv\vvvv_gamma_7.1-0144-g5b48859314-win-x64\vvvv.exe"
$packageRepo = "..\\"
$helpPatch = "help\HowTo Apply OCIO Colorspace from Config File.vl"

& $vvvvPath --package-repositories $packageRepo --editable-packages "VL.OCIO" -o $helpPatch
