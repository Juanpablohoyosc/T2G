# T2G · Tee to Green

A free, mobile-first golf GPS rangefinder that runs in the phone's browser. It's a static site with no backend, no login, no ads, no tracking and no API keys.

> Work in progress: built one feature at a time. The full README (how to use it, adding courses, accuracy limits, "Built with AI") comes with the last step.

## Done so far

- **Step 1: live distance screen.** Front, center and back of the current green in large type. Shows hole number and par, with arrows or a swipe to change holes. GPS accuracy is shown as ±X yd, with a warning past ±10 yd. Includes a yards/meters toggle, dark and sun modes, Screen Wake Lock and demo mode with a simulated player.

## Course data

A catalog of every golf course OpenStreetMap has in Northwest Arkansas ships with the app in `data/courses/`. Courses that have holes mapped are included in full. The presets and **Find golf courses near me** read this catalog, so they open instantly and don't depend on OpenStreetMap's public servers, which are often slow or down. Outside the region, "near me" falls back to a live OpenStreetMap search.

To refresh the catalog, open the **Actions** tab, choose **Fetch course data from OpenStreetMap** and click **Run workflow**. A course that fails to load keeps its previous file.

In October 2026 the catalog has 17 courses in Northwest Arkansas. Fifteen have every hole mapped:

| Course | Holes | Par on OpenStreetMap |
| --- | --- | --- |
| Bella Vista Country Club | 18 | not mapped |
| Big Sugar Golf Club | 18 | yes (72) |
| Blessings Golf Club | 18 | yes (72) |
| Brittany | 9 | not mapped |
| Brush Creek Golf Course | 9 | not mapped |
| Dogwood Golf Course | 18 | not mapped |
| Fayetteville Country Club | 18 | yes (70) |
| Highlands Golf Course | 18 | yes (72) |
| Kingswood Berksdale Golf Course | 18 | not mapped |
| Lakeside Village Golf Course | 9 | yes (27) |
| Lost Springs Golf & Athletic Club | 18 | yes (72) |
| Paradise Valley Golf and Athletic Club | 18 | yes (71) |
| Scotsdale Golf Course | 18 | not mapped |
| The Creeks | 18 | yes (71) |
| The Greens on Blossom Way | 9 | not mapped |

The Links at Bentonville and The Links at Rainbow Curve are on OpenStreetMap without holes. The Links at Fayetteville isn't on it at all.

Other courses are loaded from [OpenStreetMap](https://www.openstreetmap.org/copyright) through the free Overpass API, then saved on the phone. Holes (`golf=hole`) and greens (`golf=green`) are volunteer-mapped, so a course is only as complete as its mapping. T2G never makes up coordinates. Course data © OpenStreetMap contributors, available under the ODbL.

## Run it locally

```
python3 -m http.server 8000
```

Open http://localhost:8000. Browsers allow GPS on `localhost` and on `https://` addresses only.
