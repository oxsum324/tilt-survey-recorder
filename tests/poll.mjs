// Retry the original assertion on rendered frames; no fixed delay or relaxed condition.
export async function poll(page,assertion,timeout=15000){
  const deadline=Date.now()+timeout;
  for(;;){try{return await assertion();}catch(error){if(Date.now()>=deadline)throw error;await page.evaluate(()=>new Promise(requestAnimationFrame));}}
}
export async function reportReady(page){await page.waitForFunction(()=>document.querySelector('#reportRoot')?.dataset.ready==='true');}
