import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CaptureCard} from './CaptureCard';
import type {CaptureItem} from '../../lib/captures';
const item:CaptureItem={id:1,kind:'recording',path:'owned-fixture.mp4',width:640,height:360,bytes:100,created_at:0,title:null,thumb_url:null};
it('offers Open video instead of sending a recording to the image pin decoder',()=>{
  const html=renderToStaticMarkup(<CaptureCard item={item} variant="home" onChanged={()=>{}}/>);
  expect(html).toContain('aria-label="Open video"');
  expect(html).toContain('aria-label="Trim"');
  expect(html).not.toContain('aria-label="Pin to screen"');
});
it('keeps image pinning available for Home screenshots',()=>{
  const html=renderToStaticMarkup(<CaptureCard item={{...item,kind:'screenshot',path:'owned-fixture.png'}} variant="home" onChanged={()=>{}}/>);
  expect(html).toContain('aria-label="Pin to screen"');
});
