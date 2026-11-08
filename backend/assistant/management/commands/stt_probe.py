"""Try Whisper on real recordings and compare the two models.

    python manage.py stt_probe --file clip1.webm --file clip2.m4a
    python manage.py stt_probe --file clip.wav --language ur --models both

Each clip is sent to Groq for the request only (nothing is stored). Prints the text, the detected
language, the audio length and the time taken for each model, so you can pick EDU_STT_MODEL and
EDU_STT_LANGUAGE from what your own voices actually produce.
"""
import sys
import time
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from assistant import providers, voice
from assistant.providers import ProviderError

MODELS = {'turbo': 'whisper-large-v3-turbo', 'v3': 'whisper-large-v3'}
TYPES = {'.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg',
         '.wav': 'audio/wav', '.flac': 'audio/flac'}


class Command(BaseCommand):
    help = 'Transcribe recordings with Groq Whisper and compare models.'

    def add_arguments(self, parser):
        parser.add_argument('--file', action='append', required=True, help='Audio file; repeat for several')
        parser.add_argument('--models', choices=['configured', 'turbo', 'v3', 'both'], default='configured')
        parser.add_argument('--language', choices=['auto', 'ur', 'en'], default='auto')

    @staticmethod
    def _safe(text):
        enc = getattr(sys.stdout, 'encoding', None) or 'utf-8'
        return str(text).encode(enc, 'replace').decode(enc, 'replace')

    def handle(self, *args, **opts):
        if not providers.api_key(providers.GROQ):
            raise CommandError('EDU_GROQ_API_KEY is not set')
        chosen = {'configured': [settings.STT_MODEL], 'turbo': [MODELS['turbo']], 'v3': [MODELS['v3']],
                  'both': list(MODELS.values())}[opts['models']]
        language = voice.LANGUAGES[opts['language']] or settings.STT_LANGUAGE
        failures = 0
        for name in opts['file']:
            path = Path(name)
            if path.suffix.lower() not in TYPES or not path.is_file():
                self.stderr.write(f'skipping {path.name}: not an audio file this probe knows ({", ".join(TYPES)})')
                failures += 1
                continue
            audio = path.read_bytes()
            self.stdout.write(self.style.MIGRATE_HEADING(f'\n{path.name}  ({len(audio) // 1024} KB)'))
            for model in chosen:
                started = time.monotonic()
                try:
                    data = providers.post_transcription(audio, path.name, TYPES[path.suffix.lower()], model,
                                                        language=language, prompt=settings.STT_PROMPT)
                except ProviderError as exc:
                    self.stdout.write(self.style.ERROR(f'  {model}: FAILED ({exc.kind}) {exc}'))
                    failures += 1
                    continue
                ms = int((time.monotonic() - started) * 1000)
                self.stdout.write(f'  {model}: {ms} ms, {data.get("duration", 0):.1f} s of audio, language={data.get("language")}')
                self.stdout.write(self._safe(f'    "{(data.get("text") or "").strip()}"'))
        if failures:
            raise CommandError(f'{failures} clip(s) or call(s) failed')
