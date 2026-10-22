# T2G · Tee to Green

A free, mobile-first golf GPS rangefinder that runs in the phone's browser. It's a static site with no backend, no login, no ads, no tracking and no API keys.

> Work in progress: built one feature at a time. The full README (how to use it, adding courses, accuracy limits, "Built with AI") comes with the last step.

## Done so far

- **Home screen.** The app opens on a start menu with Continue (your current course and hole), Choose a course, Golf courses near me, Open the map and a Demo mode switch. The red **T2G** button in the top-left corner always returns to it. If you were playing in the last 4 hours, the app opens straight on your yardages instead.
- **Step 2: satellite map.** Tap any spot on any course to see the distance from you to it and from it to the green. Drag the target to fine-tune it. The current hole is drawn over the imagery (line of play, green outline, flag, bunkers, water). Esri World Imagery is the default. If it can't load, the app switches to the public-domain USGS imagery and then to the OpenStreetMap street map. The layer button also switches to the street map by hand. In demo mode you can drag the red player anywhere on the map or press **Auto-walk** to walk it from tee to green, and every number updates live.
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

**Scorecards** come from [OpenGolfAPI](https://opengolfapi.org/) (free, no key, ODbL). The same GitHub Action matches each course by location and name. When the hole counts agree, it adds handicaps and yardage per tee and fills in any missing par; OpenStreetMap's par wins if the two disagree. Courses that OpenStreetMap has no holes for are added as **scorecard** courses (par, handicap, location; measure on the map) or **map-only** courses. As a check, the scorecard yardages agree with the tee-to-green distances measured from OpenStreetMap to within a few yards on most holes (doglegs aside).

Other courses are loaded from [OpenStreetMap](https://www.openstreetmap.org/copyright) through the free Overpass API, then saved on the phone. Holes (`golf=hole`) and greens (`golf=green`) are volunteer-mapped, so a course is only as complete as its mapping. T2G never makes up coordinates. Course data © OpenStreetMap contributors, available under the ODbL.

## Run it locally

```
python3 -m http.server 8000
```

Open http://localhost:8000. Browsers allow GPS on `localhost` and on `https://` addresses only.
