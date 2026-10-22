// Home: the start menu. Resume the round, pick a course, or open the map.

import { state, setState, onState, currentCourse, currentHole } from '../state.js';

const $ = id => document.getElementById(id);

export function initHome({ showTab, openCourses, openNearMe, catalogSize }) {
  $('home-btn').addEventListener('click', () => showTab('home'));
  $('continue-card').addEventListener('click', () => showTab('gps'));
  $('home-choose').addEventListener('click', openCourses);
  $('home-near').addEventListener('click', openNearMe);
  $('home-map').addEventListener('click', () => showTab('map'));
  $('home-demo').addEventListener('change', e => setState({ demo: e.target.checked }));

  onState(render);
  render();
  catalogSize().then(n => {
    if (n) $('home-choose-sub').textContent = `${n} courses in Northwest Arkansas`;
  });
}

function render() {
  const course = currentCourse();
  const hole = currentHole();
  $('continue-card').hidden = !hole;
  if (hole) {
    $('continue-course').textContent = course.name;
    $('continue-hole').textContent = `Hole ${hole.number}${hole.par ? ` · Par ${hole.par}` : ''}`;
  }
  $('home-demo').checked = state.demo;
}
