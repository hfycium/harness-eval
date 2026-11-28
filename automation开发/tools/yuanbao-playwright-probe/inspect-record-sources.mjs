import { chromium } from 'playwright';
const c=await chromium.launchPersistentContext(process.env.YUANBAO_PROBE_PROFILE,{headless:false,channel:'msedge'});
try {
 const p=c.pages()[0]??await c.newPage(); const seen=[]; const pending=[]; const details=[];
 p.on('response',r=>{const u=new URL(r.url()); if(u.hostname.endsWith('yuanbao.tencent.com')) { seen.push({path:u.pathname,status:r.status(),content_type:r.headers()['content-type']??''}); if(u.pathname==='/api/user/agent/conversation/v1/detail') pending.push(r.json().then(x=>details.push(x)).catch(()=>{})); }});
 await p.goto('https://yuanbao.tencent.com/',{waitUntil:'domcontentloaded',timeout:60000});
 await p.locator('.yb-recent-conv-list__item-name:visible').first().click(); await p.waitForTimeout(4000);
 const body=await p.locator('body').innerText(); if(!body.includes('PROBE_STATUS_OK')) throw Error('wrong_conversation');
 const h=p.locator('.hyc-component-deep-search-agent__think__header').filter({hasText:'已处理'}); if(await h.count()===1) await h.click();
 console.log('DETAIL_RESPONSE_COUNT', seen.filter(x=>x.path==='/api/user/agent/conversation/v1/detail').length);
 console.log('RECORD_CONTROLS',JSON.stringify(await p.locator('.hyc-component-deep-search-agent button:visible,.hyc-component-deep-search-agent [role="button"]:visible').evaluateAll(es=>es.map(e=>({label:(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').trim().slice(0,100),expanded:e.getAttribute('aria-expanded')})))));
 await Promise.all(pending);
 const matches=[];
 const walk=(x,path)=>{if(typeof x==='string' && /PROBE_STATUS_OK|exit code|exit_code|exitCode/i.test(x)) matches.push({path,text:x.slice(0,1600)}); else if(x && typeof x==='object') for(const [k,v] of Object.entries(x)) walk(v,path+'.'+k);};
 for(const x of details) walk(x,'response');
 const shapes=[];
 const shape=(x,path,depth)=>{if(depth>9)return; if(Array.isArray(x)){shapes.push({path,type:'array',length:x.length}); x.slice(0,8).forEach((v,i)=>shape(v,`${path}[${i}]`,depth+1));} else if(x && typeof x==='object'){shapes.push({path,type:'object',keys:Object.keys(x)}); for(const [k,v] of Object.entries(x)) shape(v,path+'.'+k,depth+1);} else shapes.push({path,type:typeof x,...(typeof x==='number'||typeof x==='boolean'?{value:x}:{})});};
 for(const x of details) if(JSON.stringify(x).includes('PROBE_STATUS_OK')) shape(x.convs?.[0]?.speechesV2,'reply.speechesV2',0);
 console.log('REPLY_CONTENT_SHAPE',JSON.stringify(shapes.filter(x=>x.path.includes('.content'))));
 console.log('REPLY_RELATED_KEYS',JSON.stringify(shapes.filter(x=>/tool|result|status|trace|command/i.test(x.path))));
 for(const x of details) if(JSON.stringify(x).includes('PROBE_STATUS_OK')) { const s=x.convs?.[0]?.speechesV2?.[0]; const t=s?.extra?.toolCalls; const action=s?.content?.[0]?.contents?.[0]; console.log('TOOL_METADATA',JSON.stringify({toolCalls_is_null:t===null,toolCalls_type:typeof t,toolCalls_keys:t&&typeof t==='object'?Object.keys(t):[],action_type:action?.type,action_tool_name:action?.tcname,action_category:action?.cat,action_status:action?.status,item_count:action?.items?.length,item_types:action?.items?.map(y=>y.type)})); }
} finally {await c.close();}
