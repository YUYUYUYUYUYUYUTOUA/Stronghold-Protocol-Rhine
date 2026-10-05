// Content hooks are synchronous. Scope record lookups to the current match/battle,
// restoring the previous context even when nested hooks or a handler throw.
let current = null;
export const scopedGameData = () => current;
export function withGameData(data,fn){
  const raw=data?.contentData ?? data;
  // Minimal simulation fixtures still use their explicitly injected support data.
  if(!raw||typeof raw!=='object'||!['bonds','items','garrisons','bands','effects'].some(k=>Object.hasOwn(raw,k)))return fn();
  const previous=current;
  current=raw;
  try{return fn();}finally{current=previous;}
}
