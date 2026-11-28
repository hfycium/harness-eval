import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const source=await readFile('元宝边界探测/实时流探针-0.1.md','utf8');
const prompt=source.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1]; if(!prompt) throw Error('prompt_missing');
const id=randomUUID(), file=`元宝边界探测/实时流探针-${id}.json`;
const hash=x=>createHash('sha256').update(x).digest('hex');
const record={record_id:id,started_at:new Date().toISOString(),source_sha256:hash(source),prompt,prompt_sha256:hash(prompt),submission:'not_sent',responses:[],observations:[]};
await writeFile(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
let context; const pending=[];
try {
 context=await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});
 const p=context.pages()[0]??await context.newPage(); let capture=false;
 p.on('response',r=>{const u=new URL(r.url()),ct=r.headers()['content-type']??'',safePath=u.pathname.startsWith('/api/chat/')?'/api/chat/[redacted]':u.pathname; if(capture&&u.hostname.endsWith('yuanbao.tencent.com')&&/event-stream|json/i.test(ct)) pending.push((async()=>{try{const text=await r.text(); const hits=[]; for(const line of text.split(/\r?\n/)){const raw=line.replace(/^data:\s*/,''); try{const obj=JSON.parse(raw); const item=obj?.contents?.[0]?.items?.[0]?.text; if(typeof item==='string'&&item.includes('STREAM_PROBE_548219')) hits.push({field:'event.contents.0.items.0.text',excerpt:item.slice(0,300)});}catch{}} record.responses.push({path:safePath,status:r.status(),content_type:ct,hit_count:hits.length,hits:hits.slice(0,20)});}catch{record.responses.push({path:safePath,status:r.status(),content_type:ct,body:'unavailable'});}})());});
 await p.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});
 await p.getByRole('button',{name:'切换模型',exact:true}).click();
 const mode=p.locator('button:visible,[role="button"]:visible').filter({hasText:/^专家模式\s*使用工具，处理多步任务(?:\s*\(Hy4\))?$/}); await p.waitForTimeout(800); if(await mode.count()!==1) {record.observations.push({source:'model_menu',mode_count:await mode.count(),text:await p.locator('[role="menu"]:visible,[role="listbox"]:visible').allTextContents()}); throw Error('expert_mode_ambiguous');} await mode.click();
 const editor=p.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({visible:true}); if(await editor.count()!==1) throw Error('editor_ambiguous');
 await editor.fill(prompt); record.submission='send_attempting'; await writeFile(file,JSON.stringify(record,null,2)+'\n'); capture=true;
 await editor.press('Enter'); record.submission='enter_pressed_once'; await writeFile(file,JSON.stringify(record,null,2)+'\n');
 await p.waitForTimeout(45000); const body=await p.locator('body').innerText(); const i=body.indexOf(prompt);
 record.observations.push({source:'visible_page',at:new Date().toISOString(),prompt_visible:i>=0,text:i>=0?body.slice(i,i+3500):null});
 const h=p.locator('.hyc-component-deep-search-agent__think__header').filter({hasText:'已处理'}); if(await h.count()===1){await h.click(); const g=p.getByText(/已运行\d+次命令/,{exact:true}); if(await g.count()===1)await g.click(); const a=p.locator('[class*="agent-process-timeline_childTitle"]:visible'); if(await a.count()===1)await a.click(); record.observations.push({source:'product_timeline',text:await p.locator('.hyc-component-deep-search-agent').innerText().catch(()=>null)});}
 await Promise.race([Promise.allSettled(pending),new Promise(resolve=>setTimeout(resolve,5000))]);
} catch(e) {record.error=e.message;}
finally {record.finished_at=new Date().toISOString(); await writeFile(file,JSON.stringify(record,null,2)+'\n'); if(context)await context.close();}
console.log(JSON.stringify(record));
