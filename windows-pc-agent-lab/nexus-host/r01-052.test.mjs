// NEXUS 0.5.2 R-01 (release blocker): consent before deleting/erasing data inside ordinary apps.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyDestructiveClick as C, classifyDestructiveKeys as K} from './policy.mjs';
import {createGui} from './gui.mjs';
import {createConsent} from './consent.mjs';
import {validateCapabilities} from './capabilities.mjs';

const B = (name, controlType = 'Button', extra = {}) => ({elem: {controlType, name, id: ''}, ...extra});
const isC = r => r && r.level === 2 && r.what === 'destructive_action';
const DLG = {modal: true, className: '#32770', title: 'Delete File', text: ['Are you sure you want to permanently delete this file?']};
const DLG_RU = {modal: true, className: '#32770', title: 'Удаление', text: ['Вы действительно хотите удалить эти 3 элемента?']};
const PLAIN = {modal: true, className: '#32770', title: 'Options', text: ['Choose a theme']};

test('R-01 clicks: delete/remove/uninstall/erase (EN/RU/IT) need consent; ordinary buttons do not', () => {
  for (const n of ['Delete', 'Delete file', 'Remove', 'Uninstall', 'Erase all', 'Empty Recycle Bin', 'Delete permanently', 'Удалить', 'Стереть',
    'Удалить навсегда', 'Elimina', 'Rimuovi', 'Disinstalla', '&Delete']) assert.ok(isC(C(B(n))), n);
  for (const t of ['MenuItem', 'SplitButton', 'Hyperlink']) assert.ok(isC(C(B('Delete', t))), t);
  for (const n of ['Save', 'Open', 'Close', 'New file', 'Copy', 'Rename', 'Undo', 'Settings', 'Сохранить', 'Delegate', 'Removable drives', '']) assert.equal(C(B(n)), null, n);
  // a list item NAMED like that is a file/record, clicking selects it — not a deletion
  assert.equal(C(B('Delete me.txt', 'ListItem')), null);
  assert.equal(C(B('Remove old.docx', 'TreeItem')), null);
  // right click / move never delete
  assert.equal(C(B('Delete'), 'right_click'), null);
});

test('R-01 weak words: clear/reset/очистить need consent unless it is a field/search/filter context', () => {
  for (const n of ['Clear', 'Clear all', 'Clear history', 'Reset', 'Reset app', 'Очистить', 'Сбросить', 'Svuota', 'Discard changes']) assert.ok(isC(C(B(n))), n);
  for (const n of ['Clear search', 'Clear filter', 'Clear selection', 'Reset zoom', 'Очистить поиск', 'Очистить поле', 'Clear formatting']) assert.equal(C(B(n)), null, n);
  assert.equal(C(B('Clear', 'Button', {parentType: 'Edit'})), null, '× of a search box');
  assert.equal(C(B('Clear', 'Button', {parentType: 'ComboBox'})), null);
});

test('R-01 confirmation dialogs: affirmative → consent, negative/Save → free, unknown → refused (fail-closed)', () => {
  for (const n of ['Yes', 'OK', 'Delete', 'Да', 'Удалить', 'Sì', 'Continue']) assert.ok(isC(C(B(n, 'Button', {dialog: DLG}))), n);
  assert.ok(isC(C(B('Да', 'Button', {dialog: DLG_RU}))));
  for (const n of ['No', 'Cancel', 'Нет', 'Отмена', 'Annulla', 'Save']) assert.equal(C(B(n, 'Button', {dialog: DLG})), null, n);
  assert.equal(C(B('', 'Button', {dialog: DLG})).refuse, true);
  assert.equal(C(B('Proceed anyway?!', 'Button', {dialog: DLG})).refuse, undefined, 'proceed is affirmative');
  assert.equal(C(B('Frobnicate', 'Button', {dialog: DLG})).refuse, true);
  assert.equal(C(B('Yes', 'Pane', {dialog: DLG})).what, 'destructive_action', 'TaskDialog buttons are Pane');
  // a modal dialog without deletion wording: ordinary rules (OK is free)
  assert.equal(C(B('OK', 'Button', {dialog: PLAIN})), null);
  // the dialog text itself (Text control) is not a button
  assert.equal(C(B('Are you sure?', 'Text', {dialog: DLG})), null);
  // real Windows: FromPoint over a MessageBox button returned the dialog Window → button unknown → refused, never free
  assert.equal(C(B('NEXUS R01 Delete File', 'Window', {dialog: DLG})).refuse, true);
  assert.equal(C(B('', 'Group', {dialog: DLG})).refuse, true);
  // dialog text unreadable: affirmative needs consent, negative stays free
  const MUTE = {modal: false, className: '#32770', title: 'X', text: []};
  assert.ok(isC(C(B('Yes', 'Pane', {dialog: MUTE})))); assert.equal(C(B('No', 'Pane', {dialog: MUTE})), null);
  // real MessageBox shape (CI 41477712638): message and buttons are Pane descendants, all collected as text
  const MB = {modal: false, className: '#32770', title: 'NEXUS R01 Delete File', text: ['Are you sure you want to permanently delete report.docx?', 'Yes', 'No']};
  assert.ok(isC(C(B('Yes', 'Pane', {dialog: MB})))); assert.equal(C(B('No', 'Pane', {dialog: MB})), null);
  assert.equal(C(B('NEXUS R01 Delete File', 'Window', {dialog: MB})).refuse, true);
});

test('R-01 keys: Del/Shift+Del only on selected items; free in text; Ctrl+Shift+Del always; Enter in a confirmation', () => {
  for (const t of ['ListItem', 'TreeItem', 'DataItem', 'List', 'Tree', 'DataGrid']) {
    assert.ok(isC(K('delete', {elem: {controlType: t}})), t); assert.ok(isC(K('shift+delete', {elem: {controlType: t}})), t);
  }
  for (const t of ['Edit', 'Document', 'Pane', 'Custom', undefined]) assert.equal(K('delete', {elem: {controlType: t}}), null, String(t));
  assert.equal(K('delete', {elem: {controlType: 'Edit'}, parentType: 'DataItem'}), null, 'editing a cell text');
  assert.ok(isC(K('ctrl+shift+delete', {elem: {controlType: 'Document'}})));
  assert.equal(K('backspace', {elem: {controlType: 'ListItem'}}), null);
  // Enter/Space on a focused destructive button / in a confirmation dialog
  assert.ok(isC(K('enter', {elem: {controlType: 'Button', name: 'Delete'}})));
  assert.ok(isC(K('space', {elem: {controlType: 'MenuItem', name: 'Удалить'}})));
  assert.equal(K('enter', {elem: {controlType: 'Button', name: 'Save'}}), null);
  assert.ok(isC(K('enter', {elem: {controlType: 'Button', name: 'Yes'}, dialog: DLG})));
  assert.equal(K('enter', {elem: {controlType: 'Button', name: 'No'}, dialog: DLG}), null);
  assert.ok(isC(K('enter', {elem: {controlType: 'Edit', name: ''}, dialog: DLG})), 'Enter activates the default button');
  assert.equal(K('enter', {elem: {controlType: 'Button', name: ''}, dialog: DLG}).refuse, true);
  assert.equal(K('enter', {elem: {controlType: 'Edit'}}), null);
});

// ── wiring into the real gui paths (UIA + Robot mocked) ──────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-r01-'));
const INFO = {x: 0, y: 0, w: 1280, h: 720, scaleX: 1, scaleY: 1, screens: 1};
const ROOT = {x: 0, y: 0, w: 1280, h: 720};
function rig({at, ctx}) {
  const sent = [];
  const win = {hwnd: 900, pid: 40, process: 'explorer', name: 'Documents - File Explorer', tabs: []};
  const uia = async a => {
    const base = {root: ROOT};
    if (a.mode === 'focused') return {...base, focused: {ok: true, pid: 40, process: 'explorer'}};
    if (a.mode === 'at') return {...base, at: {pid: 40, process: 'explorer', controlType: 'ControlType.' + at.elem.controlType, window: win, ...at}};
    if (a.mode === 'context') return {...base, focused: {ok: true, pid: 40, process: 'explorer'}, window: win, ...ctx};
    if (a.mode === 'apps') return {...base, apps: []};
    throw Error('mode ' + a.mode);
  };
  const robot = {cmd: async c => { if (c === 'info') return INFO; sent.push(c); return {ok: true, pressed: true}; }, start: async () => {}, stop() {}};
  const consent = createConsent();
  const g = createGui({caps: validateCapabilities({gui_input: true}), home: tmp, workspace: tmp, platform: 'win32', runUia: uia, robot, consent});
  return {g, consent, sent};
}
const input = s => s.filter(c => /^(click|key|paste|move|drag|scroll)/.test(c));

test('R-01 wiring: click on «Delete» in Explorer → consent; nothing pressed until the owner allows; then exactly once', async () => {
  const r = rig({at: {elem: {controlType: 'Button', name: 'Delete', id: ''}}});
  const out = await r.g.mouse_action({action: 'click', x: 100, y: 100});
  assert.equal(out.status, 'consent_required'); assert.equal(out.what, 'destructive_action');
  assert.match(out.target, /удаление\/стирание данных.*explorer.*Delete/);
  assert.deepEqual(input(r.sent), []);
  const p = r.consent.take(out.consentId, 'allow', out.target); const done = await p.apply();
  assert.equal(done.done, true);
  assert.deepEqual(input(r.sent), ['click 100 100 left 1']);
});

test('R-01 wiring: unknown button in an «Are you sure» dialog is refused; «No» is pressed freely', async () => {
  const r = rig({at: {elem: {controlType: 'Button', name: '', id: ''}, dialog: DLG}});
  await assert.rejects(r.g.mouse_action({action: 'click', x: 10, y: 10}), /destructive_confirm_refused/);
  assert.deepEqual(input(r.sent), []);
  const r2 = rig({at: {elem: {controlType: 'Button', name: 'No', id: ''}, dialog: DLG}});
  assert.equal((await r2.g.mouse_action({action: 'click', x: 10, y: 10})).done, true);
});

test('R-01 wiring: Del on a selected file → consent; Del while typing in a field → pressed at once', async () => {
  const r = rig({ctx: {elem: {controlType: 'ListItem', name: 'report.docx', id: ''}, parentType: 'List'}});
  const out = await r.g.keyboard_action({keys: 'delete'});
  assert.equal(out.status, 'consent_required'); assert.equal(out.what, 'destructive_action');
  assert.deepEqual(input(r.sent), []);
  const r2 = rig({ctx: {elem: {controlType: 'Edit', name: '', id: ''}}});
  assert.equal((await r2.g.keyboard_action({keys: 'delete'})).done, true);
  assert.deepEqual(input(r2.sent), ['key delete']);
});
