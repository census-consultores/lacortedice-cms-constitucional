const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const base=path.resolve(__dirname,'../../..');
const ts=require('typescript');
function load(file,bindings={}){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:file})((n)=>n in bindings?bindings[n]:require(n),module,module.exports);return module.exports;}
const service=load(base+'/lacortedice-cms/src/plugins/admin-panel/server/src/services/acquisition.ts');
const bridge=load(base+'/lacortedice-webapp/src/lib/server/store-bridge.ts');
const pg=new PGlite();
function params(sql,args){let n=0;return pg.query(sql.replace(/\?/g,()=>'$'+(++n)),args);}
function db(table){let wh=[],args=[];const q={where(k,op,v){if(typeof k==='object'){for(const [name,value] of Object.entries(k)){wh.push('"'+name+'" = ?');args.push(value);}}else{wh.push('"'+k+'" '+op+' ?');args.push(v);}return q;},async first(){return (await params('SELECT * FROM '+table+' WHERE '+wh.join(' AND ')+' LIMIT 1',args)).rows[0];},insert(row){const names=Object.keys(row),values=Object.values(row);const sql='INSERT INTO '+table+' ('+names.map(n=>'"'+n+'"').join(',')+') VALUES ('+names.map(()=>'?').join(',')+')';return {then(resolve,reject){return params(sql,values).then(resolve,reject)},onConflict(col){return {ignore(){return params(sql+' ON CONFLICT ("'+col+'") DO NOTHING',values)}}}}}};return q;}
db.raw=(sql,args)=>args?params(sql,args):pg.exec(sql);
let link,receipt;
after(async()=>pg.close());
test('schema is idempotent; recipient identity stays out of URLs',async()=>{
 await service.ensureAcquisition(db);await service.ensureAcquisition(db);
 const r=await service.personalizeStoreLinks(db,'<a href="https://app.test/ir/play-store?c=congreso-01&amp;d=12">Play</a><a href="https://other.test/ir/play-store">Other</a>',undefined,'Persona@Example.test','https://app.test');
 assert(!r.html.includes('d=12'));assert(!r.html.includes('Persona'));assert(r.html.includes('https://other.test/ir/play-store'));
 link=new URL(r.html.match(/href="([^"]+)/)[1]);assert(service.validToken(link.searchParams.get('t')));
 assert.equal((await pg.query('SELECT recipient FROM marketing.links')).rows[0].recipient,'persona@example.test');
});
test('token resolves campaign server-side, ignoring caller campaign and identity',async()=>{
 const r=await service.recordClick(db,{token:link.searchParams.get('t'),campaign:'forged',recipient:'attacker@example.test',destination:'play-store',userAgent:'Mozilla/5.0'});
 assert.equal(r.campaign,'congreso-01');assert.equal(r.channel,'email');receipt=r.receipt;assert(service.validToken(receipt));
});
test('unknown token and invalid destination cannot create an attributed click',async()=>{
 await assert.rejects(()=>service.recordClick(db,{token:'f'.repeat(64),destination:'play-store'}));
 await assert.rejects(()=>service.recordClick(db,{destination:'https://evil.test'}));
});
test('recognized scanner is separated; anonymous click carries no arbitrary user ID',async()=>{
 const bot=await service.recordClick(db,{token:link.searchParams.get('t'),destination:'play-store',userAgent:'Proofpoint bot'});assert(bot.automated);assert.equal(bot.receipt,null);
 await service.recordClick(db,{campaign:'instagram-01',channel:'instagram',user_id:123,destination:'app-store',userAgent:'Mozilla/5.0'});
 const rows=(await pg.query("SELECT * FROM marketing.clicks WHERE campaign='instagram-01'")).rows;assert.equal(rows[0].link_id,null);
});
test('installation callback is idempotent and rejects impossible timestamps',async()=>{
 const now=Math.floor(Date.now()/1000);await service.recordInstall(db,{receipt,installedAt:now});await service.recordInstall(db,{receipt,installedAt:now});
 assert.equal((await pg.query('SELECT count(*)::int AS n FROM marketing.installs')).rows[0].n,1);
 await assert.rejects(()=>service.recordInstall(db,{receipt,installedAt:now+9999}));await assert.rejects(()=>service.recordInstall(db,{receipt:'a'.repeat(64),installedAt:now}));
});
test('report reports unavailable telemetry, not a false zero; total recipients not summed per store',async()=>{
 const r=await service.acquisitionReport(db,30);assert.equal(r.usageAvailable,false);assert.equal(r.nativeRecipients,null);assert.equal(r.androidInstalls,1);assert.equal(r.totals.recipients,1);assert.equal(r.totals.clicks,2);assert.equal(r.totals.automated,1);assert(r.people[0].installed_at);
});
test('native correlation excludes web activity, wrong OS and distinguishes prior use',async()=>{
 await pg.exec(`CREATE TABLE up_users(id integer PRIMARY KEY,email text);CREATE SCHEMA analytics;CREATE TABLE analytics.events(user_id integer,event_timestamp timestamptz,event_name text,device_context jsonb);INSERT INTO up_users VALUES(11,'persona@example.test');`);
 await pg.exec(`INSERT INTO analytics.events VALUES(11,now(),'page_view','{"plataforma":"web"}'),(11,now(),'page_view','{"plataforma":"ios-nativa"}');`);
 let r=await service.acquisitionReport(db,30);assert.equal(r.nativeRecipients,0);
 await pg.exec(`INSERT INTO analytics.events VALUES(11,now()-interval '1 day','session_start','{"plataforma":"android-nativa"}'),(11,now(),'page_view','{"plataforma":"android-nativa"}');`);
 r=await service.acquisitionReport(db,30);assert.equal(r.nativeRecipients,1);assert(new Date(r.people[0].first_native_observed)<new Date(r.people[0].first_click));assert(r.people[0].native_after);
});
test('Play referrer carries receipt and correct channel; Apple token stays campaign-level',()=>{
 const play=new URL(bridge.storeUrl('play-store','https://play.google.com/store/apps/details?id=app','congreso-01','email','',receipt));const ref=new URLSearchParams(play.searchParams.get('referrer'));assert.equal(ref.get('lcdt_receipt'),receipt);assert.equal(ref.get('utm_medium'),'email');
 const social=new URL(bridge.storeUrl('play-store','https://play.google.com/store/apps/details?id=app','ig-01','instagram'));assert.equal(new URLSearchParams(social.searchParams.get('referrer')).get('utm_medium'),'social');
 const apple=new URL(bridge.storeUrl('app-store','https://apps.apple.com/app/id1','camp','email','12345',receipt));assert.equal(apple.searchParams.get('pt'),'12345');assert(!apple.toString().includes(receipt));
});
test('failed persistence and malformed responses never claim tracking success',async()=>{
 await assert.rejects(()=>bridge.trackStoreClick(async()=>new Response(null,{status:503}),'https://cms.test',{}));
 await assert.rejects(()=>bridge.trackStoreClick(async()=>Response.json({recorded:false}),'https://cms.test',{}));
});
test('HTTP redirect persists before redirect, strips referrer, never caches and rejects open redirects',async()=>{
 const route=load(base+'/lacortedice-webapp/src/routes/ir/[destino]/+server.ts',{'@sveltejs/kit':{error:(s,m)=>{throw new Error(s+' '+m)}},'$env/dynamic/private':{env:{VITE_REST_URL:'https://cms.test',APPLE_PROVIDER_TOKEN:'123'}},'$lib/native/tiendas':{URL_APP_STORE:'https://apps.apple.com/app/id1',URL_GOOGLE_PLAY:'https://play.google.com/store/apps/details?id=app'},'$lib/server/store-bridge':bridge});
 let saved=false;const fetcher=async(u,opt)=>{const body=JSON.parse(opt.body);assert.equal(body.user_id,undefined);const r=await service.recordClick(db,body);saved=true;return Response.json(r)};
 const response=await route.GET({params:{destino:'play-store'},url:link,request:new Request(link,{headers:{'user-agent':'Mozilla/5.0'}}),fetch:fetcher});assert(saved);assert.equal(response.status,302);assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert(new URL(response.headers.get('location')).searchParams.get('referrer').includes('lcdt_receipt'));
 await assert.rejects(()=>route.GET({params:{destino:'https://evil.test'},url:link,request:new Request(link),fetch:fetcher}));assert.equal((await route.HEAD()).status,204);
});
test('admin report is policy-protected; templates are personalized only during real send',()=>{
 const routes=fs.readFileSync(base+'/lacortedice-cms/src/plugins/admin-panel/server/src/routes/content-api.ts','utf8');assert.match(routes,/path:'\/acquisition\/report'.*policies:\['plugin::admin-panel.isAdmin'\]/);
 const mailer=fs.readFileSync(base+'/lacortedice-cms/src/plugins/admin-panel/server/src/services/mailer.ts','utf8');assert(mailer.indexOf('const linked = await personalizeStoreLinks')>mailer.indexOf('if (!transport)'));assert(mailer.indexOf('const linked = await personalizeStoreLinks')<mailer.indexOf('const info = await transport.sendMail'));
});
test('totals cover all recipients even when the detail list is capped at 200',async()=>{
 await pg.exec(`INSERT INTO marketing.links(id,token_hash,campaign,channel,recipient)
 SELECT md5('link'||i)::uuid,lpad(i::text,64,'0'),'scale','email','test'||i||'@example.test' FROM generate_series(1,210) i;
 INSERT INTO marketing.clicks(id,link_id,campaign,channel,destination,automated)
 SELECT md5('click'||i)::uuid,md5('link'||i)::uuid,'scale','email','app-store',false FROM generate_series(1,210) i;
 INSERT INTO marketing.clicks(id,link_id,campaign,channel,destination,automated)
 SELECT md5('again'||i)::uuid,md5('link'||i)::uuid,'scale','email','play-store',false FROM generate_series(1,210) i;`);
 const r=await service.acquisitionReport(db,30);assert.equal(r.people.length,200);assert.equal(r.totals.recipients,211);assert.equal(r.summary.filter(s=>s.campaign==='scale').reduce((n,s)=>n+s.clicks,0),420);
});
