#!/usr/bin/env python3
"""Replace the voice-over of a guide video with a Microsoft neural (edge-tts) voice.

Why: the SAPI voice used by the web-demo-video skill sounds robotic. The picture is
copied untouched (-c:v copy); only the audio track is rebuilt: one TTS clip per cue,
placed at the cue's start, over ducked background music from the skill's assets.

Usage: python redub_video.py <narration.json> <in.mp4> <out.mp4> [--music calm|warm|minimal|none]
Needs: pip install edge-tts, ffmpeg/ffprobe. Narration text is sent to Microsoft.
"""
import argparse, asyncio, json, os, subprocess, tempfile
from pathlib import Path

import edge_tts

MUSIC_DIR = Path(__file__).resolve().parents[2] / ".claude/skills/web-demo-video/assets/music"
MAX_SPEEDUP = 1.25  # beyond this the voice sounds rushed; shorten the text instead


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout)


async def synth(text, voice, rate, out):
    # aiohttp ignores HTTPS_PROXY by default; sandboxed/corporate networks only allow egress through it.
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    await edge_tts.Communicate(text, voice, rate=rate, proxy=proxy).save(str(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("narration"); ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--music", default="calm")
    a = ap.parse_args()
    cfg = json.loads(Path(a.narration).read_text(encoding="utf-8"))
    voice, rate = cfg["voice"], cfg.get("rate", "-5%")
    cues = cfg["cues"]
    total = duration(a.src)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        inputs, filters, labels = ["-i", a.src], [], []
        for i, cue in enumerate(cues):
            mp3 = tmp / f"c{i}.mp3"
            asyncio.run(synth(cue["text"], voice, rate, mp3))
            # Room for a clip runs to the next cue (pages load silently in between), not just its own window.
            nxt = cues[i + 1]["start"] if i + 1 < len(cues) else total
            room = nxt - cue["start"] - 0.3
            dur = duration(mp3)
            speed = min(max(dur / room, 1.0), MAX_SPEEDUP)
            if dur / speed > room + 0.05:
                print(f"WARN cue {i}: {dur:.1f}s voice, {room:.1f}s room - shorten the text")
            inputs += ["-i", str(mp3)]
            ms = int(cue["start"] * 1000)
            filters.append(f"[{i + 1}:a]atempo={speed:.3f},adelay={ms}|{ms}[v{i}]")
            labels.append(f"[v{i}]")
        n = len(cues)
        filters.append(f"{''.join(labels)}amix=inputs={n}:normalize=0:duration=longest,"
                       f"apad=whole_dur={total},atrim=0:{total},asplit=2[voice][key]")
        if a.music != "none":
            inputs += ["-stream_loop", "-1", "-i", str(MUSIC_DIR / f"{a.music}.m4a")]
            filters.append(f"[{n + 1}:a]volume=0.5,atrim=0:{total}[m]")
            # Music dips under speech, like the skill's own mix.
            filters.append("[m][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[md]")
            filters.append("[voice][md]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5[aout]")
        else:
            filters.append("[voice]loudnorm=I=-16:TP=-1.5[aout]")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs,
                        "-filter_complex", ";".join(filters), "-map", "0:v", "-map", "[aout]",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", str(total), a.dst], check=True)
    print("wrote", a.dst)


if __name__ == "__main__":
    main()
