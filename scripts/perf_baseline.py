"""Read-only API timing baseline. Credentials come from env vars only.

PERF_BASE_URL (e.g. https://host/educationai), PERF_USER, PERF_PASS,
PERF_SCHOOL_ID (default 42), PERF_RUNS (default 5), PERF_OUT (json path).
Only GETs are sent after the login POST.
"""
import gzip
import json
import os
import statistics
import sys
import time

import requests

BASE = os.environ["PERF_BASE_URL"].rstrip("/")
USER, PASS = os.environ["PERF_USER"], os.environ["PERF_PASS"]
SCHOOL = os.environ.get("PERF_SCHOOL_ID", "42")
RUNS = int(os.environ.get("PERF_RUNS", "5"))
OUT = os.environ.get("PERF_OUT", "docs/perf/baseline-api.json")

ENDPOINTS = {
    "dashboard_health": "/api/sessions/health/",
    "dashboard_ai_summary": "/api/sessions/health/ai-summary/",
    "students_list": "/api/students/",
    "students_page_size_200": "/api/students/?page_size=200",
    "classes": "/api/classes/",
    "session_classes": "/api/sessions/session-classes/?page_size=200",
    "academic_years": "/api/sessions/academic-years/",
    "subjects": "/api/academics/subjects/",
    "exams": "/api/examinations/exams/",
    "finance_balances_all": "/api/finance/accounts/balances_all/",
    "finance_accounts": "/api/finance/accounts/",
    "hr_staff": "/api/hr/staff/",
    "hr_dashboard_stats": "/api/hr/staff/dashboard_stats/",
    "attendance_records": "/api/attendance/records/",
    "notif_unread": "/api/notifications/unread-count/",
    "notif_templates": "/api/notifications/templates/",
}


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))]


s = requests.Session()
t0 = time.perf_counter()
r = s.post(f"{BASE}/api/auth/login/", json={"username": USER, "password": PASS},
           headers={"X-School-ID": SCHOOL}, timeout=60)
login_ms = (time.perf_counter() - t0) * 1000
r.raise_for_status()
H = {"Authorization": f"Bearer {r.json()['access']}", "X-School-ID": SCHOOL,
     "Accept-Encoding": "identity"}

result = {"base": BASE, "school": SCHOOL, "runs": RUNS, "login_ms": round(login_ms),
          "taken_at": time.strftime("%Y-%m-%d %H:%M:%S"), "endpoints": {}}
for name, path in ENDPOINTS.items():
    times, status, size, gz = [], None, 0, 0
    for i in range(RUNS + 1):  # run 0 = cold
        t = time.perf_counter()
        try:
            resp = s.get(BASE + path, headers=H, timeout=60)
        except Exception as e:
            status = f"ERR {type(e).__name__}"
            break
        times.append((time.perf_counter() - t) * 1000)
        status = resp.status_code
        size, gz = len(resp.content), len(gzip.compress(resp.content))
    if len(times) < 2:
        result["endpoints"][name] = {"status": status}
        continue
    warm = times[1:]
    result["endpoints"][name] = {
        "status": status, "cold_ms": round(times[0]), "warm_median_ms": round(statistics.median(warm)),
        "warm_p95_ms": round(p95(warm)), "bytes": size, "gzip_bytes": gz,
    }
    print(f"{name:26} {status} cold={times[0]:.0f} med={statistics.median(warm):.0f} p95={p95(warm):.0f} {size}B gz={gz}B", file=sys.stderr)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(result, open(OUT, "w"), indent=2)
print("wrote", OUT)
