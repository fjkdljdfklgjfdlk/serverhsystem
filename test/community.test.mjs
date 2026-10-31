import test from 'node:test';
import assert from 'node:assert/strict';
import { safeThumbnail, identityStyle } from '../server/community.mjs';
test('image URLs are restricted to HTTPS Roblox CDN hosts',()=>{
 assert.equal(safeThumbnail('https://tr.rbxcdn.com/abc/150/150/AvatarHeadshot/Png'),'https://tr.rbxcdn.com/abc/150/150/AvatarHeadshot/Png');
 for(const url of ['javascript:alert(1)','http://tr.rbxcdn.com/a','https://rbxcdn.com.evil.test/a','https://evilrbxcdn.com/a','https://user:secret@tr.rbxcdn.com/a','https://tr.rbxcdn.com:8080/a',null])assert.equal(safeThumbnail(url),null);
});
test('rank badges preserve exact server roles and distinguish the actual group owner',()=>{
 const lead={roles:[{name:'Lead Operator',priority:253,access:true}]};assert.deepEqual(identityStyle(lead).badges,[{label:'Lead Operator',tone:'crimson'}]);assert.equal(identityStyle(lead,true).badges[0].label,'Group owner');
 assert.equal(identityStyle({roles:[{name:'Creator',priority:10}]}).rankFrame,'violet');assert.equal(identityStyle({roles:[]}).badges.length,0);
});
