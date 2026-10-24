#!/usr/bin/env python3
"""Build narration/<video>.json from a texts file: cue start times come from the video's .vtt,
so only the wording is written by hand. Usage: build_narration.py texts_en.json"""
import json, re, sys
from pathlib import Path

VIDEOS = Path(__file__).resolve().parents[2] / "frontend/public/videos"
OUT = Path(__file__).resolve().parent / "narration"
VOICES = {"en": "en-US-AriaNeural", "ur": "ur-PK-UzmaNeural"}


def starts(vtt):
    return [(int(h) * 3600 + int(m) * 60 + float(s))
            for h, m, s in re.findall(r"^(\d+):(\d+):([\d.]+) -->", vtt.read_text(encoding="utf-8"), re.M)]


for name, texts in json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).items():
    lang = name.rsplit(".", 1)[1]
    t = starts(VIDEOS / f"{name}.vtt")
    assert len(t) == len(texts), f"{name}: {len(t)} cues but {len(texts)} texts"
    cfg = {"voice": VOICES[lang], "rate": "-5%", "cues": [{"start": a, "text": b} for a, b in zip(t, texts)]}
    (OUT / f"{name}.json").write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print("built", name)
