import assert from 'node:assert/strict';
export async function assertVisible(locator){
 assert.equal(await locator.count(),1,'Expected one visible target');
 assert.equal(await locator.isVisible(),true,'Target must have a visible box');
 assert.equal(await locator.evaluate(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})),true,'Target and ancestors must be visibly rendered');
}
