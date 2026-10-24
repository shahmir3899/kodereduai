#!/usr/bin/env python3
"""Re-dub every video named on the command line (narration/<name>.json) and replace it in place.
A video is only replaced when it passes: same length as the original, voice audible, no overflow warning.
Usage: redub_batch.py name1.en name2.en ...   Prints one status line per video."""
import re, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIDEOS = HERE.parents[1] / "frontend/public/videos"


def probe(f, entry):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", entry, "-of", "csv=p=0", str(f)],
                                capture_output=True, text=True).stdout.split()[0])


def mean_volume(f):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(f), "-map", "0:a", "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    m = re.findall(r"mean_volume: (-?[\d.]+) dB", err)
    return float(m[-1]) if m else -99.0


for name in sys.argv[1:]:
    src, tmp = VIDEOS / f"{name}.mp4", Path(tempfile.mkdtemp()) / f"{name}.mp4"
    r = subprocess.run([sys.executable, str(HERE / "redub_video.py"), str(HERE / "narration" / f"{name}.json"), str(src), str(tmp)],
                       capture_output=True, text=True)
    warns = [l for l in r.stdout.splitlines() if l.startswith("WARN")]
    problems = list(warns)
    if r.returncode or not tmp.exists():
        problems.append("failed: " + r.stderr.strip().splitlines()[-1][:120])
    else:
        if abs(probe(tmp, "format=duration") - probe(src, "format=duration")) > 0.3: problems.append("length changed")
        vol = mean_volume(tmp)
        if vol < -30: problems.append(f"voice too quiet ({vol} dB)")
    if problems:
        print(f"FAIL {name}: {'; '.join(problems)}")
    else:
        shutil.move(tmp, src)
        print(f"OK   {name}: {probe(src, 'format=duration'):.1f}s, mean {vol:.1f} dB")
