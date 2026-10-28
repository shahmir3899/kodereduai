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


def module_enabled(enabled_modules, module):
    """Same answer as isModuleEnabled in the frontend AuthContext: a module the school never listed is off."""
    if not module:
        return True
    config = (enabled_modules or {}).get(module)
    if isinstance(config, bool):
        return config
    if isinstance(config, dict):
        return bool(config.get('enabled'))
    return False


def videos_for_role(role, enabled_modules):
    """Ids of every video meant for a role, minus modules the school turned off.

    A video with no roles is for everyone, exactly as the guide page shows it (guideAccess.js);
    treating [] as "nobody" left those videos out of the admin counts while the viewer saw them.
    The total is derived from catalog.json so new videos count automatically.
    """
    return {
        v['id'] for v in load()['videos']
        if (not v.get('roles') or role in v['roles']) and module_enabled(enabled_modules, v.get('module'))
    }


def step_requirements(role, enabled_modules):
    """[(section_id, video_id or None)] for a role; hides steps whose module the school turned off."""
    out = []
    for section_id in steps_for_role(role):
        video = video_for_section(section_id)
        module = video['module'] if video else None
        if not module_enabled(enabled_modules, module):
            continue
        out.append((section_id, video['id'] if video else None))
    return out


def person_counts(role, enabled_modules, completed):
    """The numbers one person sees, shared by their own guide page and the admin overview.

    `completed` is the set of (kind, key) pairs this person has finished.
    """
    reqs = step_requirements(role, enabled_modules)
    done = sum(1 for section_id, video_id in reqs if (('video', video_id) if video_id else ('step', section_id)) in completed)
    role_videos = videos_for_role(role, enabled_modules)
    # Only videos meant for this role count, so "x / total" can never exceed 100%.
    watched = sum(1 for kind, key in completed if kind == 'video' and key in role_videos)
    return {'steps_done': done, 'steps_total': len(reqs), 'videos_watched': watched, 'videos_total': len(role_videos)}
