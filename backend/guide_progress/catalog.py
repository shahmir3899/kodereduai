"""What counts toward a person's guide progress.

catalog.json is written by generate_user_guide.py (never edit by hand): the "Start here"
steps per role plus the videos and the section each one explains.
"""
import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def load():
    path = Path(__file__).with_name('catalog.json')
    return json.loads(path.read_text(encoding='utf-8'))


def video_ids():
    return {v['id'] for v in load()['videos']}


def step_ids():
    return {s for steps in load()['startHere'].values() for s in steps}


def steps_for_role(role):
    return load()['startHere'].get(role, [])


def video_for_section(section_id):
    for v in load()['videos']:
        if v['section'] == section_id:
            return v
    return None


def videos_for_role(role, enabled_modules):
    """Ids of every video meant for a role, minus modules the school turned off.

    The total is derived from catalog.json so new videos count automatically.
    """
    return {
        v['id'] for v in load()['videos']
        if role in v.get('roles', []) and enabled_modules.get(v.get('module')) is not False
    }


def step_requirements(role, enabled_modules):
    """[(section_id, video_id or None)] for a role; hides steps whose module the school turned off."""
    out = []
    for section_id in steps_for_role(role):
        video = video_for_section(section_id)
        module = video['module'] if video else None
        if module and enabled_modules.get(module) is False:
            continue
        out.append((section_id, video['id'] if video else None))
    return out
