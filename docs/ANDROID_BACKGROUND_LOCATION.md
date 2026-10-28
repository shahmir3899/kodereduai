# Android background location (driver bus tracking)

Written 2026-10-28 for the mobile app's Driver role. Used for the Google Play Console "Location permissions" declaration, and as the checklist for the first real-device test.

## What the app does

A driver taps **Start journey**. From then until **End journey**, the phone sends its position to the school about every 30 seconds so that the parents of students on that route can see where the bus is. This must keep working when the screen is off or the app is not in front, so the app asks for background location ("Allow all the time") and runs an Android foreground service with a visible notification ("Journey in progress").

Nothing is collected outside a journey. Only the driver role can start one. Positions are visible only to the parents of students assigned to the same route, and to school admins.

## Play Console declaration text

**Core functionality that needs background location**
> Education AI lets a school bus driver share the live bus location with the parents of the students on that route. The driver starts a journey in the app and the location is sent while the phone is locked or the app is in the background, until the driver ends the journey. Without background access the bus stops updating as soon as the screen turns off, which defeats the feature.

**Why foreground-only is not enough**
> A driver cannot keep the screen on and the app open for a whole route while driving. Tracking must continue with the screen off.

**User-visible disclosure (shown before the system prompt, in the app)**
> Education AI uses this phone's location, including while the app is closed or the screen is off, to show parents where the school bus is during a journey. Location is sent only between Start journey and End journey. Only the parents of students on your route can see the bus. A notification stays on screen while it is being shared.

**Video for review:** record (1) opening the app as a driver, (2) the disclosure screen, (3) the system permission prompt choosing "Allow all the time", (4) Start journey, the foreground notification, lock the phone, (5) a parent account seeing the bus move, (6) End journey and the notification disappearing.

**Permissions in `app.json`:** `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`.

## How tracking is built (so a reviewer or a future change knows)

- The journey id is stored on the phone (`services/trackingStore.ts`), so the background task still knows it after Android kills the app. Before 2026-10-28 it was kept only in memory and every position was silently dropped after a kill.
- A position that cannot be sent (no signal) is kept in a small queue. When signal returns, only the newest is sent, because the server stamps each position with the time it arrives and would show older ones as current (`services/tracking.ts`).
- If the server answers that the journey is no longer active (404), tracking stops and the stored journey is cleared.
- If the app is reopened, it puts the location task back for a remembered journey and checks the journey's state with the server. If a journey is active on the route but the phone has lost it, Home offers "Resume sharing".
- Ending a journey with no signal asks before giving up, because the journey would stay open for parents.

## First real-device test checklist

Needs a fresh APK build (new native-affecting code paths: background task, foreground service). Use a test driver account on a test school, a vehicle assigned to a route with at least one student assigned, and a parent account for that student. Do not use real families.

1. Fresh install, log in as the driver. Home shows vehicle, route, stops.
2. Tap Start journey: the disclosure appears first, then the system prompt. Choose **Allow all the time**. The journey starts and the "Journey in progress" notification appears.
3. Lock the phone and walk or drive for 5 minutes. As the parent, open Children, the child, **Track bus**: the position updates about every 30 to 45 seconds.
4. Turn on airplane mode for 2 minutes, then off. Journey screen shows "Not reporting" and a queue count, then recovers; the parent sees the bus jump to the current spot (not a replay).
5. Swipe the app away from recents with the journey running. Wait 2 minutes. The parent should still see updates (this is the case the fix is for). Reopen the app: Home shows the journey in progress.
6. Force-stop the app in Android settings, reopen: Home shows "Resume sharing" or the journey in progress.
7. In Android settings, change location to "Only while using the app": the Journey screen shows the permission warning and "Fix permission".
8. Turn GPS off, try Start journey: a clear message, no crash.
9. End journey with data off: the confirm explains the journey stays open; end it again with data on and it closes.
10. Battery: note the percentage drop over a 30 minute journey, with the screen off.
11. Boarding tab: roster shows only your route's students; mark some; Save; reopen: marks persist. Admin web Transport Attendance shows the same marks for today.
12. A driver with no vehicle or no route sees a clear message on Home and Boarding.

Record failures in `docs/PHASE5_KNOWN_FAILURES.md`.
