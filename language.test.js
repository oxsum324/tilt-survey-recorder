import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import fs from 'node:fs/promises';
// Explicit common-character dictionary, escaped so the dictionary itself remains scannable.
const dictionary='\u65e0\u4e0e\u6d4b\u8bd5\u6c49\u8bed\u7b80\u4f53\u4e3a\u8fd9\u6765\u65f6\u4e2a\u4eec\u53d1\u540e\u8fdb\u5b9e\u73b0\u573a\u56fe\u6570\u5bfc\u8f93\u9009\u9879\u8bbe\u50a8\u5f55\u8bfb\u5199\u53d8\u5f00\u5173\u7f51\u9875\u590d\u9a8c\u9519\u8bef\u7ebf\u6807\u70b9\u8ba1\u8bc1\u6863\u636e\u5e93\u4ece\u5e94\u5c06\u5bf9\u8fc7\u8fde\u663e';
test('追蹤文字檔不得出現常見簡體字（至少三十字）',async()=>{
 assert.ok(new Set(dictionary).size>=30);const findings=[];
 const names=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
 for(const name of names){const bytes=await fs.readFile(name);if(bytes.includes(0))continue;const text=bytes.toString('utf8');for(const ch of new Set(dictionary))if(text.includes(ch))findings.push({file:name,codePoint:'U+'+ch.codePointAt(0).toString(16)});}
 assert.deepEqual(findings,[]);
});
