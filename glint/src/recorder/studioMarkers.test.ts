import {expect,it} from 'vitest';
import {importZoomMarkers} from './studioMarkers';
import type {StudioEvents} from './studioModel';
const events={version:1,geometry:{x:-1000,y:100,width:2000,height:1000},events:[{kind:'marker',t:2,x:0,y:600}]} as StudioEvents;
it('imports a recorded marker at its source focus and keeps it out of auto regeneration',()=>{
  const imported=importZoomMarkers([],[],events,10);expect(imported.zoomSegments).toHaveLength(1);
  expect(imported.zoomSegments[0].focus).toEqual({x:.5,y:.5});expect(imported.zoomSegments[0].origin).toBe('marker');
});
it('does not duplicate markers or resurrect a marker segment deleted by hand',()=>{
  const first=importZoomMarkers([],[],events,10);
  expect(importZoomMarkers(first.zoomSegments,first.importedMarkers,events,10)).toEqual(first);
  expect(importZoomMarkers([],first.importedMarkers,events,10).zoomSegments).toEqual([]);
});
