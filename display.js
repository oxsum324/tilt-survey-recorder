// Device preferences are independent of case data and print appearance.
export function setupDisplay(){
  const sun=document.querySelector('#sunlightButton'),wake=document.querySelector('#wakeButton');let sunlight=false,enabled=true,lock=null,pending=false;
  try{sunlight=localStorage.getItem('tilt-survey-sunlight')==='true';enabled=localStorage.getItem('tilt-survey-wake')!=='false';}catch{}
  function showSun(){document.documentElement.classList.toggle('sunlight',sunlight);sun.textContent=sunlight?'強光：開啟':'強光：關閉';sun.setAttribute('aria-pressed',sunlight);document.dispatchEvent(new Event('tilt:displaychange'));}
  function showWake(text){wake.textContent=`螢幕常亮：${text}`;wake.setAttribute('aria-pressed',enabled);}
  async function request(){
    if(!('wakeLock' in navigator)){showWake('不支援');return;}
    if(!enabled){showWake('已關閉');return;}
    if(document.visibilityState!=='visible'){showWake('已暫停');return;}
    if(lock&&!lock.released){showWake('已啟用');return;}if(pending)return;pending=true;
    try{const acquired=await navigator.wakeLock.request('screen');lock=acquired;acquired.addEventListener('release',()=>{if(lock===acquired){lock=null;showWake(enabled?'已暫停':'已關閉');}});if(!enabled||document.visibilityState!=='visible')await acquired.release();else showWake('已啟用');}catch{showWake('已暫停');}finally{pending=false;}
  }
  sun.addEventListener('click',()=>{sunlight=!sunlight;try{localStorage.setItem('tilt-survey-sunlight',sunlight);}catch{}showSun();});
  wake.addEventListener('click',async()=>{enabled=!enabled;try{localStorage.setItem('tilt-survey-wake',enabled);}catch{}if(!enabled&&lock)await lock.release();await request();});
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'){if(lock)await lock.release();if(enabled)showWake('已暫停');}else await request();});
  showSun();request();
}
