import test from 'node:test';
import assert from 'node:assert/strict';
import {isQuiet,channelNotifies} from '../static/notification-preferences.js';
const store=value=>({getItem:()=>value});
test('quiet hours span midnight in the selected timezone',()=>{
  const storage=store(JSON.stringify({quiet_start:'22:00',quiet_end:'08:00',time_zone:'America/Sao_Paulo'}));
  assert.equal(isQuiet('one',storage,new Date('2026-10-22T02:00:00Z')),true);
  assert.equal(isQuiet('one',storage,new Date('2026-10-22T15:00:00Z')),false);
});
test('invalid quiet settings do not silence all activity accidentally',()=>{
  assert.equal(isQuiet('one',store('{broken')),false);
  assert.equal(isQuiet('one',store(JSON.stringify({quiet_start:'20:00',quiet_end:'08:00',time_zone:'not/a/timezone'}))),false);
});
test('muted channels suppress mentions while direct messages use separate preferences',()=>{
  assert.equal(channelNotifies('one',{scope:'a',mentioned:true},store('none')),false);
  assert.equal(channelNotifies('one',{scope:'a',mentioned:false},store('mentions')),false);
  assert.equal(channelNotifies('one',{scope:'a',mentioned:true},store('mentions')),true);
  assert.equal(channelNotifies('one',{scope:'a',private:true},store('none')),true);
});
