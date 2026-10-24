#!/usr/bin/env python3
"""Make the narration audio for a web-demo-video scenario through Microsoft's neural voices (edge-tts).

The skill's own online-voice call does not use the HTTPS proxy this cloud environment requires, so the
audio is generated here and the scenario uses {"voice": {"engine": "files"}} with the result.

    node ... > items.json   (see the workflow note in the commit) then:
    python3 make_voice.py items.json audio
The text is sent to Microsoft; only run it after the user has approved the narration.
"""
import asyncio, json, os, sys
from pathlib import Path

import edge_tts

VOICES = {"en": "en-US-AriaNeural", "ur": "ur-PK-UzmaNeural"}
RATE = "-5%"


async def main(items_path, out_dir):
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    items = json.loads(Path(items_path).read_text(encoding="utf-8"))
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    for lang, rows in items.items():
        for row in rows:
            out = Path(out_dir) / f"{row['key'].replace(':', '-')}.{lang}.mp3"
            await edge_tts.Communicate(row["text"], VOICES[lang], rate=RATE, proxy=proxy).save(str(out))
            print("made", out.name)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
