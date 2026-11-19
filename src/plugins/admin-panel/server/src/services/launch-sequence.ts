import { TEMPLATES } from '../data/lanzamiento-octubre';
import { DIRECTORIO_PROFESIONALES } from '../data/directorio-profesionales';
import { ABOGADOS_RANKING, NIVELES_QUE_SE_ENVIAN } from '../data/ranking-legal';
import { sendMailMasivo, urlBaja, isConfigured } from './mailer';

const RUN = 'app-octubre-2026';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const LABELS = {iedt:'Instituto Ecuatoriano de Derecho Tributario (IEDT)',ranking:'Ranking Legal',congreso:'Congreso constitucional y tributario',judicial:'Función Judicial · tributario'};
export async function ensureLaunch(db: any) {
 await db.raw(`CREATE SCHEMA IF NOT EXISTS marketing;
 CREATE TABLE IF NOT EXISTS marketing.launch_settings (id text PRIMARY KEY, active boolean NOT NULL DEFAULT false, start_at timestamptz, tested_at timestamptz, last_tick timestamptz, daily_limit int NOT NULL DEFAULT 240);
 INSERT INTO marketing.launch_settings(id) VALUES ('${RUN}') ON CONFLICT DO NOTHING;
 UPDATE marketing.launch_settings SET daily_limit=240 WHERE id='${RUN}' AND start_at IS NULL AND active=false;
 CREATE TABLE IF NOT EXISTS marketing.launch_queue (id bigserial PRIMARY KEY, email varchar(320) NOT NULL UNIQUE, segment varchar(20) NOT NULL, stage int NOT NULL DEFAULT 1, due_at timestamptz, status varchar(24) NOT NULL DEFAULT 'pending', sent_at timestamptz, error text);
 CREATE INDEX IF NOT EXISTS launch_due ON marketing.launch_queue(status,due_at);
 CREATE TABLE IF NOT EXISTS marketing.launch_deliveries(id bigserial PRIMARY KEY, email varchar(320) NOT NULL, template varchar(40) NOT NULL, status varchar(24) NOT NULL, test boolean NOT NULL DEFAULT false, attempted_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, message_id text, error text);
 CREATE UNIQUE INDEX IF NOT EXISTS launch_once ON marketing.launch_deliveries(email,template) WHERE test=false;`);
}
function rows(r:any) {return r.rows ?? r;}
export async function launchStatus(strapi:any) {
 const db=strapi.db.connection;
 return {settings:await db('marketing.launch_settings').where({id:RUN}).first(),smtp:isConfigured(),cron:process.env.CRON_ENABLED==='true',labels:LABELS,
 groups:rows(await db.raw('SELECT segment,status,count(*)::int AS total FROM marketing.launch_queue GROUP BY segment,status ORDER BY segment,status')),
 totals:rows(await db.raw(`SELECT status,test,count(*)::int AS total FROM marketing.launch_deliveries GROUP BY status,test`)),
 recent:await db('marketing.launch_deliveries').orderBy('id','desc').limit(30),
 templates:Object.entries(TEMPLATES).map(([id,t])=>({id,subject:t.subject})),
 uncertain:rows(await db.raw(`SELECT count(*)::int AS total FROM marketing.launch_queue WHERE status='sending'`))[0].total};
}
export async function importLaunch(strapi:any,input:any) {
 if(!Array.isArray(input)||input.length>15000)throw new Error('Lista inválida');
 const base=[...input,...DIRECTORIO_PROFESIONALES.map(p=>({email:p.correo,segment:'iedt'})),...ABOGADOS_RANKING.filter(a=>NIVELES_QUE_SE_ENVIAN.includes(a.nivel)).map(a=>({email:a.correo,segment:'ranking'}))];
 const unique=new Map<string,string>();
 for(const r of base){const email=String(r.email??'').trim().toLowerCase();if(!EMAIL.test(email)||email.length>320||!Object.prototype.hasOwnProperty.call(LABELS,r.segment))throw new Error('Contacto o segmento inválido');if(!unique.has(email))unique.set(email,r.segment);}
 // Fail closed: suppression storage failure must never become an empty suppression list.
 const bajas=await strapi.db.query('api::correo-baja.correo-baja').findMany({select:['correo']});
 const suppressed=new Set(bajas.map((x:any)=>String(x.correo).trim().toLowerCase()));
 let added=0;
 await strapi.db.connection.transaction(async(trx:any)=>{const settings=await trx('marketing.launch_settings').where({id:RUN}).forUpdate().first();if(settings.active)throw new Error('Pause la campaña antes de importar');
 for(const [email,segment] of unique){if(suppressed.has(email))continue;const r=await trx('marketing.launch_queue').insert({email,segment,due_at:settings.start_at??null}).onConflict('email').ignore().returning('id');added+=r.length;}});
 return {added,unique:unique.size,suppressed: [...unique.keys()].filter(e=>suppressed.has(e)).length};
}
export async function sendLaunch(strapi:any,email:string,template:string,test=false) {
 if(!TEMPLATES[template]||!EMAIL.test(email))throw new Error('Correo o plantilla inválidos');
 const campaign=`lcdt_app_202610_${template}`;
 const html=TEMPLATES[template].html.split('{{URL_BAJA}}').join(urlBaja(email,campaign));
 if(/{{[^}]+}}/.test(html))throw new Error('Plantilla incompleta');
 const result=await sendMailMasivo({to:email,subject:(test?'[PRUEBA] ':'')+TEMPLATES[template].subject,html,campana:campaign});
 return result;
}
export async function launchTest(strapi:any,email:string,template:string) {
 email=email.trim().toLowerCase();
 const result=await sendLaunch(strapi,email,template,true);
 await strapi.db.connection('marketing.launch_deliveries').insert({email,template,test:true,status:result.sent?'sent':'error',sent_at:result.sent?new Date():null,message_id:result.messageId??null,error:result.error??(result.dryRun?'SMTP en simulación':null)});
 if(result.sent)await strapi.db.connection('marketing.launch_settings').where({id:RUN}).update({tested_at:new Date()});
 return result;
}
export async function configureLaunch(strapi:any,body:any) {
 const db=strapi.db.connection;
 if(body.active===false){await db('marketing.launch_settings').where({id:RUN}).update({active:false});return {active:false};}
 if(body.active!==true)throw new Error('Acción inválida');
 const start=new Date(body.startAt);
 if(!Number.isFinite(+start)||+start<Date.now()-60000)throw new Error('La fecha debe ser futura');
 if(!isConfigured()||process.env.MAIL_DRY_RUN==='true'||process.env.CRON_ENABLED!=='true')throw new Error('SMTP o programador no disponibles');
 await db.transaction(async(trx:any)=>{
 const settings=await trx('marketing.launch_settings').where({id:RUN}).forUpdate().first();
 if(!settings.tested_at)throw new Error('Primero debe enviarse una prueba correctamente');
 if(!(await trx('marketing.launch_queue').first()))throw new Error('Importe los contactos primero');
 // Keep legacy app mail campaigns off, so one shared SMTP queue owns this launch.
 const active=await strapi.db.query('api::campana-correo.campana-correo').findMany({where:{activa:true}});
 if(active.length)throw new Error('Detenga primero las campañas anteriores activas');
 await trx('marketing.launch_settings').where({id:RUN}).update({active:true,start_at:start});
 await trx('marketing.launch_queue').where({status:'pending',stage:1}).update({due_at:start});
 });return {active:true,startAt:start.toISOString(),dailyLimit:240};
}
export function launchWindow(now=new Date()) {const local=new Date(+now-5*3600000);return local.getUTCDay()>0&&local.getUTCDay()<6&&local.getUTCHours()>=9&&local.getUTCHours()<17;}
export function nextStageAt(now:Date,stage:number){const d=new Date(+now+(stage===1?6:7)*86400000);while([0,6].includes(new Date(+d-5*3600000).getUTCDay()))d.setUTCDate(d.getUTCDate()+1);return d;}
// Apply the approved daily budget from day one; keep per-tick/hour safeguards.
export function effectiveLimit(settings:any, _now=new Date()) {
 return Math.max(0,Math.min(Number(settings.daily_limit)||0,240));
}
let busy=false;
export async function tickLaunch(strapi:any) {
 if(busy)return;busy=true;
 const db=strapi.db.connection;
 try{
 await db('marketing.launch_settings').where({id:RUN}).update({last_tick:new Date()});
 if(!launchWindow())return;
 for(let n=0;n<8;n++){
 // Transaction reserves durable sending state before SMTP. A crash/ambiguous result stays held; never auto-resend.
 const item=await db.transaction(async(trx:any)=>{
 const settings=await trx('marketing.launch_settings').where({id:RUN}).forUpdate().first();
 if(!settings.active||!settings.start_at||+new Date(settings.start_at)>Date.now())return null;
 const count=rows(await trx.raw(`SELECT count(*)::int AS n FROM marketing.launch_deliveries WHERE test=false AND attempted_at >= date_trunc('day',now() AT TIME ZONE 'America/Guayaquil') AT TIME ZONE 'America/Guayaquil'`))[0].n;
 if(count>=effectiveLimit(settings))return null;
 const hour=rows(await trx.raw(`SELECT count(*)::int AS n FROM marketing.launch_deliveries WHERE attempted_at>now()-interval '1 hour'`))[0].n;
 if(hour>=40)return null;
 const legacy=await strapi.db.query('api::campana-correo.campana-correo').findMany({where:{activa:true}});if(legacy.length)return null;
 const q=await trx('marketing.launch_queue').where({status:'pending'}).where('due_at','<=',new Date()).orderBy('stage','desc').orderBy('due_at').orderBy('id').forUpdate().first();if(!q)return null;
 const bajas=await strapi.db.query('api::correo-baja.correo-baja').findMany({select:['correo']});
 if(bajas.some((b:any)=>String(b.correo).trim().toLowerCase()===q.email)){await trx('marketing.launch_queue').where({id:q.id}).update({status:'suppressed'});return {skip:true};}
 const template=`${q.segment}-${String(q.stage).padStart(2,'0')}`;
 await trx('marketing.launch_queue').where({id:q.id}).update({status:'sending'});
 const [delivery]=await trx('marketing.launch_deliveries').insert({email:q.email,template,status:'sending'}).returning('id');
 return {...q,template,delivery:delivery.id};
 });
 if(!item)break;if(item.skip)continue;
 const result=await sendLaunch(strapi,item.email,item.template);
 await db.transaction(async(trx:any)=>{
 await trx('marketing.launch_deliveries').where({id:item.delivery}).update({status:result.sent?'sent':'error',sent_at:result.sent?new Date():null,message_id:result.messageId??null,error:result.error??(result.dryRun?'SMTP en simulación':null)});
 await trx('marketing.launch_queue').where({id:item.id}).update(result.sent?{status:item.stage===4?'completed':'pending',stage:Math.min(4,item.stage+1),sent_at:new Date(),due_at:item.stage===4?null:nextStageAt(new Date(),item.stage)}:{status:'error',error:result.error??'SMTP no disponible'});
 });
 // Stop on first failure to protect the shared transactional sender.
 if(!result.sent){await db('marketing.launch_settings').where({id:RUN}).update({active:false});break;}
 }
 }catch(e:any){strapi.log.error('[launch-sequence] '+e.message);await db('marketing.launch_settings').where({id:RUN}).update({active:false}).catch(()=>{});}finally{busy=false;}
}
export default ({strapi}:any)=>({tick:()=>tickLaunch(strapi)});
