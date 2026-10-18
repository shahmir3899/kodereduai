"""Signed-in page-load baseline using headless Chromium (Playwright). Read-only.

Credentials never appear in args: PERF_USER / PERF_PASS come from env vars (the
run command reads them out of CLAUDE.md in the user's own shell).
PERF_HOST   school host, e.g. demo.educationai.pk
PERF_OUT    json path (default docs/perf/baseline-pages-v2.json)
PERF_IDLE_S idle polling window in seconds (default 60)

Per page it records two modes, because the shell/preload calls fire per boot, not per click:
  hard = full page load (what a refresh or deep link costs)
  spa  = client-side navigation from the already-booted dashboard (what a click costs)
Each mode logs every API call with start/end ms relative to the navigation, so the order
and the waterfall are visible. Also saves the school's enabled_modules from auth/me.
Only navigations + GETs the SPA itself makes. The one form submit is the login.
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

HOST = os.environ.get("PERF_HOST", "")
LOCAL_BASE = os.environ.get("PERF_BASE")  # e.g. http://localhost:3001 (local build, dev test login only)
SUBDOMAIN = os.environ.get("PERF_SUBDOMAIN")  # local dev resolves the school from ?subdomain=
USER, PASS = os.environ["PERF_USER"], os.environ["PERF_PASS"]
OUT = os.environ.get("PERF_OUT", "docs/perf/baseline-pages-v2.json")
IDLE_S = int(os.environ.get("PERF_IDLE_S", "60"))
BASE = LOCAL_BASE or f"https://{HOST}"
QS = f"?subdomain={SUBDOMAIN}" if SUBDOMAIN else ""
PAGES = {
    "dashboard": "/dashboard",
    "students_list": "/students",
    "student_profile": "/students/{student_id}",
    "exams": "/academics/exams",
    "fee_collect": "/finance/fees/collect",
    "finance_dashboard": "/finance",
    "subjects": "/academics/subjects",
}


def depth(calls):
    """Sequential round trips: longest chain where a call starts after another ended."""
    calls = sorted(calls, key=lambda c: c["start"])
    best = [1] * len(calls)
    for i, c in enumerate(calls):
        for j in range(i):
            if calls[j]["end"] <= c["start"]:
                best[i] = max(best[i], best[j] + 1)
    return max(best) if best else 0


def measure(page, navigate):
    """Run navigate(), then wait for the network to go quiet; return call log + timings."""
    calls, pending = [], {}
    t0 = time.perf_counter()

    def on_req(r):
        if "/api/" in r.url:
            pending[r] = time.perf_counter() - t0

    def on_done(r):
        if r in pending:
            calls.append({"url": r.url.split("/api/")[1].split("?")[0],
                          "start": round(pending.pop(r) * 1000), "end": round((time.perf_counter() - t0) * 1000)})

    page.on("request", on_req)
    page.on("requestfinished", on_done)
    page.on("requestfailed", on_done)
    navigate()
    try:
        page.wait_for_load_state("networkidle", timeout=30000)
    except Exception:
        pass
    time.sleep(1.5)  # preload tier B starts ~1.2 s after boot; make sure it is counted
    try:
        page.wait_for_load_state("networkidle", timeout=30000)
    except Exception:
        pass
    idle_ms = round((time.perf_counter() - t0) * 1000)
    for ev, fn in (("request", on_req), ("requestfinished", on_done), ("requestfailed", on_done)):
        page.remove_listener(ev, fn)
    calls.sort(key=lambda c: c["start"])
    return {"api_requests": len(calls), "waterfall_depth": depth(calls),
            "total_ms_incl_1.5s_settle": idle_ms, "calls": calls}


def spa_click(page, path):
    """Client-side navigation by clicking the real <a href> (JS click works even if the menu group is collapsed)."""
    ok = page.evaluate(
        "p => { const a = document.querySelector('a[href=\"' + p + '\"]'); if (!a) return false; a.click(); return true; }",
        path)
    if not ok:
        return False
    try:
        page.wait_for_function("p => location.pathname === p", arg=path, timeout=8000)
    except Exception:
        return False
    return True


def main():
    out = {"host": HOST, "taken_at": time.strftime("%Y-%m-%d %H:%M:%S"), "pages": {}}
    found, me = {}, {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1366, "height": 800})

        def new_page():
            """Fresh page per measurement so late requests from the previous page cannot leak in."""
            pg = ctx.new_page()

            def on_response(r):
                try:
                    if "/api/students/" in r.url and r.request.method == "GET" and "id" not in found:
                        found["id"] = r.json()["results"][0]["id"]
                    if "/api/auth/me/" in r.url and r.status == 200:
                        me.update(r.json())
                except Exception:
                    pass

            pg.on("response", on_response)
            return pg

        page = new_page()
        page.goto(BASE + "/login" + QS, wait_until="load", timeout=90000)
        page.fill("input[type=password]", PASS)
        page.locator("input:not([type=password]):not([type=checkbox])").first.fill(USER)
        # "Remember me" keeps the tokens in localStorage; without it they live in sessionStorage,
        # which each new page (tab) would not share, and every later page would land on the login form.
        page.check("input[type=checkbox]")
        page.click("button[type=submit]")
        page.wait_for_load_state("networkidle", timeout=45000)
        print("signed in at", page.url, file=sys.stderr)
        probe = ctx.new_page()
        probe.goto(BASE + "/dashboard" + QS, wait_until="load", timeout=90000)
        probe.wait_for_load_state("networkidle", timeout=30000)
        if probe.locator("input[type=password]").count():
            sys.exit("Login did not persist across pages (landed on the login form). Aborting.")
        probe.close()
        page.close()

        order = ["students_list"] + [n for n in PAGES if n != "students_list"]
        for name in order:
            path = PAGES[name]
            if "{student_id}" in path:
                if "id" not in found:
                    out["pages"][name] = {"error": "no student id seen"}
                    continue
                path = path.format(student_id=found["id"])
            pg = new_page()
            hard = measure(pg, lambda: pg.goto(BASE + path + QS, wait_until="load", timeout=90000))
            pg.close()
            spa = None
            if name != "dashboard":
                pg = new_page()
                pg.goto(BASE + "/dashboard" + QS, wait_until="load", timeout=90000)
                pg.wait_for_load_state("networkidle", timeout=30000)
                time.sleep(4)  # let the dashboard preload (tier B) finish before the click
                res = {}
                spa = measure(pg, lambda: res.update(ok=spa_click(pg, path)))
                spa["navigated"] = res.get("ok", False)
                pg.close()
            out["pages"][name] = {"hard": hard, "spa": spa}
            print(f"{name:18} hard: api={hard['api_requests']:3} depth={hard['waterfall_depth']} "
                  f"t={hard['total_ms_incl_1.5s_settle']}ms | spa: "
                  + (f"navigated={spa['navigated']} api={spa['api_requests']:3} depth={spa['waterfall_depth']} t={spa['total_ms_incl_1.5s_settle']}ms" if spa else "n/a"),
                  file=sys.stderr)

        # enabled modules of the school, from auth/me captured during the hard loads
        mods = {}
        for sch in (me.get("schools") or []):
            if isinstance(sch, dict) and sch.get("enabled_modules"):
                mods[str(sch.get("id") or sch.get("name"))] = sch["enabled_modules"]
        out["enabled_modules"] = mods
        out["me_keys"] = sorted(me.keys())
        for k, m in mods.items():
            on = sorted(x for x, v in m.items() if (v if isinstance(v, bool) else bool((v or {}).get("enabled"))))
            print("school", k, "ON:", on, "OFF:", sorted(set(m) - set(on)), file=sys.stderr)

        page = new_page()
        page.goto(BASE + "/dashboard" + QS, wait_until="load")
        page.wait_for_load_state("networkidle", timeout=30000)
        time.sleep(4)
        seen = []
        page.on("request", lambda r: seen.append(r.url.split("/api/")[1].split("?")[0]) if "/api/" in r.url else None)
        time.sleep(IDLE_S)
        out["idle_polling"] = {"seconds": IDLE_S, "requests": len(seen),
                               "per_minute": round(len(seen) * 60 / IDLE_S, 1),
                               "by_endpoint": {u: seen.count(u) for u in sorted(set(seen))},
                               "note": "headless; polling may be paused by page visibility"}
        print("idle polling:", out["idle_polling"], file=sys.stderr)
        browser.close()
    # Compare hard-load API counts with the first valid baseline (docs/perf/baseline-pages.json)
    try:
        base = json.load(open("docs/perf/baseline-pages.json", encoding="utf8"))["pages"]
        print("\nHARD LOAD API CALLS  before -> after", file=sys.stderr)
        for name, r in out["pages"].items():
            b = base.get(name, {}).get("cold_nav", {})
            a = r.get("hard", {})
            if b and a:
                print(f"  {name:18} {b['api_requests']:3} -> {a['api_requests']:3}   depth {b['waterfall_depth']} -> {a['waterfall_depth']}", file=sys.stderr)
    except Exception as e:
        print("no comparison:", e, file=sys.stderr)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=2)
    print("wrote", OUT)


main()
