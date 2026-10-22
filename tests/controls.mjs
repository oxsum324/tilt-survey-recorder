// Open the real disclosure before interacting with a field moved by the mobile UI.
export async function revealControl(locator){await locator.evaluate(e=>{for(let parent=e.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});}
export function fieldControl(page,path){
 const locator=page.locator(`[data-field="${path}"]`);
 return new Proxy(locator,{get(target,key){if(['fill','selectOption','check','uncheck','press'].includes(key))return async(...args)=>{await revealControl(target);return target[key](...args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
}
