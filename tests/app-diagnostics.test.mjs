import test from 'node:test';
import assert from 'node:assert/strict';
import {createCounters}from '../static/app-diagnostics.js';
test('technical counters reject identifiers and cap/reduce batches',()=>{
 const counters=createCounters();counters.add('private room name','javascript_error');counters.add('voice','actual exception text');
 for(let i=0;i<100;i++)counters.add('voice','javascript_error');
 assert.deepEqual(counters.take(),[{screen:'voice',signal:'javascript_error',count:20}]);assert.deepEqual(counters.take(),[]);
 counters.add('messages','view');counters.clear();assert.deepEqual(counters.take(),[]);
});
