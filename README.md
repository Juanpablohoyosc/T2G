# T2G · Tee to Green

A free, mobile-first golf GPS rangefinder that runs in the phone's browser. It's a static site with no backend, no login, no ads, no tracking and no API keys.

> Work in progress: built one feature at a time. The full README (how to use it, adding courses, accuracy limits, "Built with AI") comes with the last step.

## Done so far

- **Step 1: live distance screen.** Front, center and back of the current green in large type. Shows hole number and par, with arrows or a swipe to change holes. GPS accuracy is shown as ±X yd, with a warning past ±10 yd. Includes a yards/meters toggle, dark and sun modes, Screen Wake Lock and demo mode with a simulated player.

## Course data

Courses are loaded from [OpenStreetMap](https://www.openstreetmap.org/copyright) through the free Overpass API, then saved on the phone. Holes (`golf=hole`) and greens (`golf=green`) are volunteer-mapped, so a course is only as complete as its mapping. T2G never makes up coordinates. Course data © OpenStreetMap contributors, available under the ODbL.

## Run it locally

```
python3 -m http.server 8000
```

Open http://localhost:8000. Browsers allow GPS on `localhost` and on `https://` addresses only.
