param(
  [Parameter(Mandatory = $true)][string]$TextFile,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Voice = '',
  [int]$Rate = 0,
  [int]$Volume = 100
)
# Offline text to speech with the voices that come with Windows. The text is read from a file so quotes and Urdu are safe.
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice) { $s.SelectVoice($Voice) }
  $s.Rate = $Rate
  $s.Volume = $Volume
  $s.SetOutputToWaveFile($Out)
  $text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
  $s.Speak($text)
} finally {
  $s.Dispose()
}
