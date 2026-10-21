import {expect,it} from 'vitest';
import {accentForeground} from './accentContrast';
it('keeps primary action labels readable across the accent palette and dark custom colors',()=>{for(const hex of ['#2baaad','#5b7cfa','#7c6efa','#d4870a','#d95f76','#fff'])expect(accentForeground(hex)).toBe('#000000');for(const hex of ['#000','#112233','#151515'])expect(accentForeground(hex)).toBe('#ffffff');});
