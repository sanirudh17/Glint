export interface MotionBlur {enabled:boolean;intensity:number}
export const DEFAULT_MOTION:MotionBlur={enabled:false,intensity:.35};
/** Light shutter samples only when the camera transform moves; never sample old unmasked video. */
export function motionTimes(config:MotionBlur,time:number,travel:number):number[] {
  if(!config.enabled||config.intensity<=0||travel<=2)return [time];
  const shutter=config.intensity/60;
  return [time,Math.max(0,time-shutter/2),Math.max(0,time-shutter)];
}
