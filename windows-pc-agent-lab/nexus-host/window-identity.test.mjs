import test from 'node:test';
import assert from 'node:assert/strict';
import {windowIdentity, sameWindowIdentity, safeWholeWindow} from './window-identity.mjs';
import {createConsent} from './consent.mjs';
import {fixtureIdentity} from './window-identity-fixture.mjs';

const token = 'NEXUS-abc123';
const w = (hwnd = 12, pid = 41, process = 'Notepad', tabs = []) =>
  fixtureIdentity({hwnd, pid, process, name: token, tabs});
const register = (c, win = w()) => c.recordCreated([], [win], 'test', {token});

test('complete native identity is mandatory', () => {
  const win = w(); const id = windowIdentity(win);
  assert.deepEqual(id, {hwnd: '12', pid: 41, process: 'notepad', nativePid: 41,
    startTime: win.startTime, nativeStart: win.nativeStart, windowRid: '42.12'});
  for (const bad of [null, {}, {...win, hwnd: 0}, {...win, pid: 0}, {...win, nativePid: 0},
    {...win, process: ''}, {...win, startTime: ''}, {...win, nativeStart: null}, {...win, windowRid: ''}])
    assert.equal(windowIdentity(bad), null);
});
test('recycled HWND, PID, native owner or UIA id fail closed', () => {
  const win = w(), id = windowIdentity(win);
  assert.equal(sameWindowIdentity(id, {...win, process: 'NOTEPAD.exe'}), true);
  for (const changed of [w(12, 42), w(12, 41, 'Explorer'), w(13), {hwnd: 12}, null,
    {...win, startTime: '638010000000000001'}, {...win, nativeStart: '638010000000000001'},
    {...win, nativePid: 99}, {...win, windowRid: '42.912'}])
    assert.equal(sameWindowIdentity(id, changed), false);
});
test('same-process HWND reuse without original scratch token is not owned', () => {
  const c = createConsent(); register(c);
  assert.equal(c.ownsWindow(w()), true);
  const replacement = {...w(), name: 'owner document'};
  assert.equal(c.ownsWindow(replacement), false);
  assert.equal(c.gate({kind: 'window', via: 'test'}, replacement, null, {}).status, 'consent_required');
  assert.equal(safeWholeWindow(w(12,41,'Explorer'), token), false);
  assert.equal(safeWholeWindow({...w(), name: 'unmarked'}, null), false);
});
test('PID reuse invalidates ownership and scratch', () => {
  const c = createConsent(); register(c);
  assert.equal(c.isScratch(w(), null), true);
  const replacement = {...w(), startTime: '638010000000000001'};
  assert.equal(c.ownsWindow(replacement), false);
  assert.equal(c.isScratch(replacement, null), false);
  c.prune([replacement]);
  assert.equal(c.owned.windows.has('12'), false);
  assert.equal(c.owned.scratch.has('12'), false);
});
test('tab RID cannot transfer to another hwnd or process; scratch name must match', () => {
  const tab = {rid: 'nx', name: token, selected: true};
  const c = createConsent(); register(c, w(12, 41, 'Notepad',[tab]));
  assert.equal(c.ownsTab(w(12, 41, 'Notepad',[tab]), tab), true);
  assert.equal(c.ownsTab(w(13, 41, 'Notepad',[tab]), tab), false);
  assert.equal(c.ownsTab(w(12, 42, 'Notepad',[tab]), tab), false);
  assert.equal(c.ownsTab(w(12, 41, 'Notepad',[{...tab,name:'owner'}]), {...tab,name:'owner'}), false);
  assert.equal(c.isScratch(w(13,41,'Notepad',[tab]),tab),false);
  c.prune([w(13, 41, 'Notepad',[tab])]);
  assert.equal(c.owned.tabs.has('nx'), false);
});
test('owner tab prevents whole-window close, stale entries removed and audited', () => {
  const events=[]; const c=createConsent({audit:e=>events.push(e)}); register(c);
  assert.equal(c.isOwned({kind:'window'},w(12,41,'Notepad',[{rid:'owner'}]),null),false);
  c.forgetStale(w());
  assert.equal(c.ownsWindow(w()),false);
  assert.ok(events.some(e=>e.event==='ownership_changed'));
});
test('discard rights do not survive identity replacement or stale removal', () => {
  const c=createConsent(); register(c);
  assert.equal(c.isOwned({kind:'discard'},w(),null),false);
  c.armDiscard(w());
  assert.equal(c.isOwned({kind:'discard'},w(),null),true);
  assert.equal(c.isOwned({kind:'discard'},{...w(),windowRid:'42.99'},null),false);
  c.forgetStale(w());
  assert.equal(c.isOwned({kind:'discard'},w(),null),false);
});
test('incomplete snapshots never grant ownership', () => {
  const c=createConsent(); const win={hwnd:12,pid:41,process:'Notepad',name:token,tabs:[]};
  assert.deepEqual(register(c,win).windows,[]);
  assert.equal(c.ownsWindow(win),false);
});
