import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer, GROUP } from '../server/main.mjs';
import { validateAction, roleState, banPayload, AppError } from '../server/policy.mjs';
import { Roblox } from '../server/roblox.mjs';
import { readFileSync } from 'node:fs';
const policy=JSON.parse(readFileSync(new URL('../server/role-policy.json',import.meta.url)));
const LEAD='907620068', MEMBER='12884901889', OWNER='715241040', TESTER='906198165';
const member=(id,roles)=>({user:`users/${id}`,roles:roles.map(r=>`groups/${GROUP}/roles/${r}`)});
async function fixture(t, extraEnv={}){
 const ranks=new Map([['10',[LEAD]],['20',[MEMBER]],['30',[OWNER]],['40',[LEAD]]]);
 const descriptions=new Map();const calls=[];
 const rb={
  resolve:async name=>({id:name==='LowUser'?20:10,name}),
  profile:async id=>({id:Number(id),name:'User'+id,displayName:'User '+id,description:descriptions.get(String(id))||''}),
  membership:async id=>ranks.has(id)?member(id,ranks.get(id)):null,
  checkBot:async()=>{},cookieAction:async(...args)=>{calls.push(args);},
  cloud:async(...args)=>{calls.push(args);if(rb.failure)throw rb.failure;return {};}
 };
 const {server,db}=makeServer({env:{PUBLIC_ORIGIN:'http://localhost:8787',BOT_USER_ID:'99',ROBLOX_API_KEY:'test-key',ROBLOX_COOKIE:'test-cookie',...extraEnv},databasePath:':memory:',roblox:rb});
 ranks.set('99',[OWNER]);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>server.close(r)));
 const root=`http://127.0.0.1:${server.address().port}`;
 async function request(path,data,token,options={}){
  const response=await fetch(root+'/api'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(options.origin?{Origin:options.origin}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
  return {status:response.status,body:await response.json(),headers:response.headers};
 }
 async function login(name='StaffUser'){
  const c=await request('/auth/challenge',{username:name});assert.equal(c.status,200);descriptions.set(c.body.user.id,c.body.phrase);
  const v=await request('/auth/verify',{challengeToken:c.body.challengeToken});assert.equal(v.status,200,JSON.stringify(v.body));return {token:v.body.token,c};
 }
 return {request,login,ranks,descriptions,calls,rb,db,root};
}
const valid={action:'experience-ban',targetId:'20',reason:'Repeated rule violations after warnings.',privateReason:'Case SH-10: multiple staff reports.',duration:86400,includeAlts:false};
test('anonymous access, forged sessions, unexpected origins, and static secret paths are denied',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/me')).status,401);
 assert.equal((await f.request('/actions/confirm',{intentToken:'x'.repeat(43)})).status,401);
 assert.equal((await f.request('/audit',undefined,'x'.repeat(43))).status,401);
 assert.equal((await f.request('/health',undefined,null,{origin:'https://evil.example'})).status,403);
 assert.equal((await f.request('/health')).body.configured,true);
 for(const path of ['/.env','/server/role-policy.json','/data/serverh.sqlite','/constructor','/__proto__']) assert.equal((await fetch(f.root+path)).status,404);
 assert.equal((await fetch(f.root+'/serverh-logo.png')).headers.get('content-type'),'image/png');
});
test('bio ownership and rank are both required; challenges are single use and expire',async t=>{
 const f=await fixture(t);const c=await f.request('/auth/challenge',{username:'StaffUser'});
 assert.equal((await f.request('/auth/verify',{challengeToken:c.body.challengeToken})).status,403);
 f.descriptions.set('10',c.body.phrase);const v=await f.request('/auth/verify',{challengeToken:c.body.challengeToken});assert.equal(v.status,200);
 assert.equal((await f.request('/auth/verify',{challengeToken:c.body.challengeToken})).status,401);
 const low=await f.request('/auth/challenge',{username:'LowUser'});f.descriptions.set('20',low.body.phrase);
 assert.equal((await f.request('/auth/verify',{challengeToken:low.body.challengeToken,rank:255,verified:true})).status,403);
 f.db.exec('UPDATE challenges SET expires=0');assert.equal((await f.request('/auth/verify',{challengeToken:low.body.challengeToken})).status,401);
});
test('role revocation invalidates a previously authenticated session',async t=>{
 const f=await fixture(t),{token}=await f.login();assert.equal((await f.request('/me',undefined,token)).status,200);
 f.ranks.set('10',[MEMBER]);assert.equal((await f.request('/audit',undefined,token)).status,403);assert.equal((await f.request('/me',undefined,token)).status,401);
});
test('blank reasons, invalid durations, peers, owners, self, bot, and protected grants are blocked',async t=>{
 const f=await fixture(t),{token}=await f.login();
 for(const patch of [{reason:''},{reason:'        '},{duration:0},{duration:-1},{duration:1.5},{duration:31536001},{privateReason:''},{action:'anything'},{targetId:'10'},{targetId:'30'},{targetId:'40'},{targetId:'99'},{action:'assign-role',roleId:LEAD}]){
  const r=await f.request('/actions/prepare',{...valid,...patch,rank:255},token);assert.ok(r.status>=400,JSON.stringify(patch));
 }
 assert.equal(f.calls.length,0);
});
test('reviews are session bound, recheck target roles, and cannot replay',async t=>{
 const f=await fixture(t),{token}=await f.login();const p=await f.request('/actions/prepare',valid,token);assert.equal(p.status,200);
 const second=await f.login('OtherStaff');assert.equal((await f.request('/actions/confirm',{intentToken:p.body.intentToken},second.token)).status,404);
 f.ranks.set('20',[MEMBER,TESTER]);assert.equal((await f.request('/actions/confirm',{intentToken:p.body.intentToken},token)).status,409);
 f.ranks.set('20',[MEMBER]);const done=await f.request('/actions/confirm',{intentToken:p.body.intentToken},token);assert.equal(done.status,200);
 assert.equal((await f.request('/actions/confirm',{intentToken:p.body.intentToken},token)).status,409);assert.equal(f.calls.length,1);
 assert.match(f.calls[0][0],/universes\/7933292768\/user-restrictions\/20/);assert.equal(f.calls[0][2].gameJoinRestriction.duration,'86400s');
 const log=await f.request('/audit',undefined,token);assert.equal(log.body.entries[0].status,'succeeded');
});
test('unknown upstream outcomes are audited and never retried by replay',async t=>{
 const f=await fixture(t),{token}=await f.login();const p=await f.request('/actions/prepare',valid,token);const e=new AppError(502,'Timeout');e.uncertain=true;f.rb.failure=e;
 assert.equal((await f.request('/actions/confirm',{intentToken:p.body.intentToken},token)).status,502);
 assert.equal((await f.request('/audit',undefined,token)).body.entries[0].status,'unknown');
 assert.equal((await f.request('/actions/confirm',{intentToken:p.body.intentToken},token)).status,409);assert.equal(f.calls.length,1);
});
test('simultaneous confirmation sends at most one mutation',async t=>{
 const f=await fixture(t),{token}=await f.login();const p=await f.request('/actions/prepare',valid,token);
 const results=await Promise.all([f.request('/actions/confirm',{intentToken:p.body.intentToken},token),f.request('/actions/confirm',{intentToken:p.body.intentToken},token)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.calls.length,1);
});
test('new unknown roles fail closed and all multi-role privileges are checked',()=>{
 assert.throws(()=>roleState(member('20',['9999']),policy,GROUP));
 const actor={id:'10',...roleState(member('10',[LEAD]),policy,GROUP)},target=roleState(member('20',[MEMBER,OWNER]),policy,GROUP);
 assert.throws(()=>validateAction(valid,actor,target,policy,'99'));
 assert.equal(banPayload({...valid,duration:'permanent'},'10').gameJoinRestriction.duration,undefined);
 assert.equal(banPayload(valid,'10').gameJoinRestriction.excludeAltAccounts,true);
});
test('Open Cloud membership lookup follows pagination and rejects unexpected users',async()=>{
 let count=0;const rb=new Roblox({apiKey:'key',groupId:GROUP,universeId:'7933292768',fetchImpl:async()=>new Response(JSON.stringify(++count===1?{groupMemberships:[],nextPageToken:'page2'}:{groupMemberships:[member('20',[MEMBER])] }),{status:200})});
 assert.equal((await rb.membership('20')).user,'users/20');assert.equal(count,2);
});
test('cookie actions retry only explicit CSRF rejections',async()=>{
 let count=0;const rb=new Roblox({cookie:'test',groupId:GROUP,fetchImpl:async(url,options)=>{count++;if(count===1)return new Response('',{status:403,headers:{'x-csrf-token':'fresh'}});assert.equal(options.headers['x-csrf-token'],'fresh');return new Response('',{status:200});}});
 await rb.cookieAction('users/20','DELETE');assert.equal(count,2);
});
test('verification throttles repeated guesses and session expiry is enforced',async t=>{
 const f=await fixture(t),{token}=await f.login();f.db.exec('UPDATE sessions SET expires=0');assert.equal((await f.request('/me',undefined,token)).status,401);
 const c=await f.request('/auth/challenge',{username:'StaffUser'});
 for(let i=0;i<12;i++)assert.equal((await f.request('/auth/verify',{challengeToken:c.body.challengeToken})).status,403);
 assert.equal((await f.request('/auth/verify',{challengeToken:c.body.challengeToken})).status,429);
});

test('Pages and VPS origins are allowlisted exactly, while lookalikes remain blocked',async t=>{
 const pages='https://fjkdljdfklgjfdlk.github.io',vps='https://serverh.uhbacon.cloud';
 const f=await fixture(t,{PUBLIC_ORIGINS:pages+','+vps});
 for(const origin of [pages,vps]){
  const r=await f.request('/health',undefined,null,{origin});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);
  const response=await fetch(f.root+'/api/auth/challenge',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization'}});
  assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.match(response.headers.get('access-control-allow-headers'),/Authorization/);
 }
 for(const origin of [pages+'.evil.example','https://attacker.github.io','null']){
  const r=await f.request('/health',undefined,null,{origin});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
});

test('staff can look up outside users, roleless members, and protected or unknown-role profiles',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/users/lookup',{query:'50'})).status,401);
 const {token}=await f.login();f.ranks.set('60',[]);f.ranks.set('70',['9999']);
 const guest=await f.request('/users/lookup',{query:'50'},token);
 assert.equal(guest.status,200);assert.equal(guest.body.user.isMember,false);assert.equal(guest.body.user.role,'Not in group');
 assert.ok(guest.body.user.allowedActions.includes('experience-ban'));assert.ok(guest.body.user.allowedActions.includes('group-ban'));
 assert.ok(!guest.body.user.allowedActions.includes('assign-role'));assert.ok(!guest.body.user.allowedActions.includes('kick'));
 const roleless=await f.request('/users/lookup',{query:'60'},token);
 assert.equal(roleless.status,200);assert.equal(roleless.body.user.isMember,true);assert.deepEqual(roleless.body.user.roles,[]);
 assert.ok(roleless.body.user.allowedActions.includes('assign-role'));assert.ok(roleless.body.user.allowedActions.includes('kick'));
 assert.ok(!roleless.body.user.allowedActions.includes('remove-role'));
 for(const id of ['10','30','40','99','70']){
  const r=await f.request('/users/lookup',{query:id},token);assert.equal(r.status,200);assert.equal(r.body.user.manageable,false);assert.deepEqual(r.body.user.allowedActions,[]);
 }
 assert.equal((await f.request('/actions/prepare',{...valid,targetId:'70'},token)).status,403);
 const legacy=await f.request('/member',{userId:'50'},token);assert.equal(legacy.status,200);assert.equal(legacy.body.user.id,'50');
});
test('username search resolves the exact account and rejects bad queries or uncertain memberships',async t=>{
 const f=await fixture(t),{token}=await f.login();let resolved;
 f.rb.resolve=async(name,options)=>{resolved={name,options};return {id:50,name};};
 const result=await f.request('/users/lookup',{query:'OutsideUser'},token);
 assert.equal(result.status,200);assert.equal(result.body.user.id,'50');assert.deepEqual(resolved,{name:'OutsideUser',options:{excludeBannedUsers:false}});
 for(const query of ['','@name','a display name','0','9007199254740992'])assert.equal((await f.request('/users/lookup',{query},token)).status,400);
 const membership=f.rb.membership;
 f.rb.membership=async id=>id==='50'?Promise.reject(new AppError(502,'Unavailable')):membership(id);
 assert.equal((await f.request('/users/lookup',{query:'50'},token)).status,502);
 f.rb.membership=async id=>id==='50'?{user:'users/50'}:membership(id);
 const uncertain=await f.request('/users/lookup',{query:'50'},token);assert.equal(uncertain.status,200);assert.equal(uncertain.body.user.policyConfirmed,false);assert.deepEqual(uncertain.body.user.allowedActions,[]);
});
test('outside-group temporary and permanent bans and unbans retain reviews, reasons, and audit',async t=>{
 const f=await fixture(t),{token}=await f.login();
 assert.equal((await f.request('/actions/prepare',{...valid,targetId:'50',reason:''},token)).status,400);
 for(const patch of [{duration:60},{duration:'permanent'},{action:'experience-unban'},{action:'group-ban'},{action:'group-unban'}]){
  const action={...valid,targetId:'50',...patch};const plan=await f.request('/actions/prepare',action,token);assert.equal(plan.status,200,JSON.stringify(plan.body));
  assert.equal((await f.request('/actions/confirm',{intentToken:plan.body.intentToken},token)).status,200);
 }
 assert.equal(f.calls.length,5);assert.equal(f.calls[0][2].gameJoinRestriction.duration,'60s');assert.equal(f.calls[1][2].gameJoinRestriction.duration,undefined);assert.equal(f.calls[2][2].gameJoinRestriction.active,false);
 assert.deepEqual(f.calls[3],['bans/50','POST']);assert.deepEqual(f.calls[4],['bans/50','DELETE']);
 const logs=(await f.request('/audit',undefined,token)).body.entries;assert.equal(logs.length,5);assert.ok(logs.every(row=>row.actor_id==='10'&&row.target_id==='50'&&row.status==='succeeded'));
 for(const action of ['assign-role','remove-role','kick'])assert.equal((await f.request('/actions/prepare',{...valid,action,roleId:MEMBER,targetId:'50'},token)).status,400);
 assert.equal(f.calls.length,5);
});
test('roleless members can receive a role but gain no panel access, and membership changes invalidate reviews',async t=>{
 const f=await fixture(t),{token}=await f.login();f.ranks.set('60',[]);
 const plan=await f.request('/actions/prepare',{action:'assign-role',targetId:'60',roleId:MEMBER,reason:valid.reason},token);assert.equal(plan.status,200);
 assert.equal((await f.request('/actions/confirm',{intentToken:plan.body.intentToken},token)).status,200);
 assert.match(f.calls[0][0],/memberships\/60:assignRole/);
 const outside=await f.request('/actions/prepare',{...valid,targetId:'50'},token);assert.equal(outside.status,200);
 f.ranks.set('50',[]);assert.equal((await f.request('/actions/confirm',{intentToken:outside.body.intentToken},token)).status,409);
 f.ranks.set('10',[]);assert.equal((await f.request('/me',undefined,token)).status,403);
});
test('session is valid across page restores, expires in one hour, and browser expiry cannot extend it',async t=>{
 const f=await fixture(t),before=Date.now(),{token}=await f.login();
 const first=(await f.request('/me',undefined,token)).body.user.expires;
 assert.ok(first>=before+3600000&&first<=Date.now()+3600000);
 assert.equal((await f.request('/me',undefined,token)).body.user.expires,first);
 f.db.exec('UPDATE sessions SET expires=0');assert.equal((await f.request('/me',undefined,token)).status,401);
});
