/** Overlapping effects need separate lanes so labels and handles stay usable. */
export function effectTrackLanes(segments:{id:string;start:number;end:number}[]) {
  const ends:number[]=[],lanes=new Map<string,number>();
  for(const segment of [...segments].sort((a,b)=>a.start-b.start)){
    let lane=ends.findIndex(end=>end<=segment.start);
    if(lane<0)lane=ends.length;
    ends[lane]=segment.end;lanes.set(segment.id,lane);
  }
  return {lanes,count:Math.max(1,ends.length)};
}
