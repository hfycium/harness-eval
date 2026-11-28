import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const source=await readFile('元宝边界探测/实时事件结构探针-0.1.md','utf8');
const prompt=source.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1]; if(!prompt)throw Error('prompt_missing');
const hash=x=>createHash('sha256').update(x).digest('hex'), id=randomUUID(), file=`元宝边界探测/实时事件结构-${id}.json`;
const record={id,started_at:new Date().toISOString(),source_sha256:hash(source),prompt_sha256:hash(prompt),submission:'not_sent',events:[],observations:[]};
const save=()=>writeFile(file,JSON.stringify(record,null,2)+'\n');await writeFile(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});let c;const pending=[];
try{
 c=await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});const p=c.pages()[0]??await c.newPage();let capture=false;
 p.on('response',r=>{const u=new URL(r.url()),ct=r.headers()['content-type']??'';if(capture&&u.hostname.endsWith('yuanbao.tencent.com')&&ct.includes('event-stream'))pending.push((async()=>{try{const text=await r.text();for(const line of text.split(/\r?\n/)){try{const o=JSON.parse(line.replace(/^data:\s*/,''));const paths=[];const walk=(v,k,d)=>{if(d>6)return;if(Array.isArray(v)){paths.push({path:k,kind:'array',length:v.length});v.slice(0,3).forEach((x,i)=>walk(x,`${k}[${i}]`,d+1));}else if(v&&typeof v==='object'){paths.push({path:k,kind:'object',keys:Object.keys(v)});for(const [a,b] of Object.entries(v))walk(b,`${k}.${a}`,d+1);}else paths.push({path:k,kind:v===null?'null':typeof v,...((typeof v==='number'||typeof v==='boolean')?{value:v}:{}),...((['type','role','tcname','cat'].includes(k.split('.').at(-1))&&typeof v==='string'&&v.length<40)?{value:v}:{})});};walk(o,'event',0);record.events.push(paths);}catch{}}}catch{record.error='event_stream_body_unavailable';}})());});
 await p.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});await p.getByRole('button',{name:'切换模型',exact:true}).click();
 const mode=p.locator('button:visible,[role="button"]:visible').filter({hasText:/^专家模式\s*使用工具，处理多步任务(?:\s*\(Hy4\))?$/});await p.waitForTimeout(800);if(await mode.count()!==1)throw Error('expert_mode_ambiguous');await mode.click();
 const ed=p.locator('textarea,[contenteditable="true"],[role="textbox"]').filter({visible:true});if(await ed.count()!==1)throw Error('editor_ambiguous');await ed.fill(prompt);record.submission='send_attempting';await save();capture=true;await ed.press('Enter');record.submission='enter_pressed_once';await save();
 await p.waitForTimeout(45000);const body=await p.locator('body').innerText();record.observations.push({source:'visible_page',prompt_visible:body.includes(prompt),command_marker_visible:body.includes('EVENT_SCHEMA_672341')});
 await Promise.race([Promise.allSettled(pending),new Promise(resolve=>setTimeout(resolve,5000))]);
}catch(e){record.error=e.message;}finally{record.finished_at=new Date().toISOString();await save();if(c)await c.close();}
console.log(JSON.stringify({id,submission:record.submission,event_count:record.events.length,error:record.error??null,observations:record.observations}));
