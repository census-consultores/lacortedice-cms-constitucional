import { launchStatus, importLaunch, launchTest, configureLaunch } from '../services/launch-sequence';
export default ({strapi}:any)=>({
 async status(ctx:any){ctx.body=await launchStatus(strapi);},
 async import(ctx:any){try{ctx.body=await importLaunch(strapi,ctx.request.body?.contacts);}catch(e:any){ctx.status=400;ctx.body={error:e.message};}},
 async test(ctx:any){try{const email=String(ctx.request.body?.email??'');const template=String(ctx.request.body?.template??'congreso-01');ctx.body=await launchTest(strapi,email,template);}catch(e:any){ctx.status=400;ctx.body={error:e.message};}},
 async configure(ctx:any){try{ctx.body=await configureLaunch(strapi,ctx.request.body??{});}catch(e:any){ctx.status=400;ctx.body={error:e.message};}},
});
