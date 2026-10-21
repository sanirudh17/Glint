/** Choose the higher-contrast text for an arbitrary saved accent. */
export function accentForeground(hex:string):'#000000'|'#ffffff'{
 let h=hex.replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');if(!/^[0-9a-f]{6}$/i.test(h))return '#ffffff';
 const linear=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
 const luminance=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];
 return (luminance+.05)/.05>=1.05/(luminance+.05)?'#000000':'#ffffff';
}
