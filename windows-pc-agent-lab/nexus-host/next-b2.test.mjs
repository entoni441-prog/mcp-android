// NEXUS NEXT block 2: NX-052-28 context classification (Calculator «Очистить» is not data deletion).
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDestructiveClick, classifyDestructiveKeys} from './policy.mjs';

const at = (process, name, controlType = 'Button') => ({process, elem: {controlType, name}, parentType: 'Pane'});

test('NX-052-28: Calculator clear/reset buttons are free; the same words elsewhere still need consent; strong words always do', () => {
  for (const n of ['Очистить', 'Очистить элемент', 'Clear', 'Clear entry', 'Сброс']) {
    assert.equal(classifyDestructiveClick(at('CalculatorApp', n)), null, n);
    assert.equal(classifyDestructiveClick(at('calc.exe', n)), null, n);
  }
  assert.equal(classifyDestructiveClick(at('notepad', 'Очистить')).what, 'destructive_action');
  assert.equal(classifyDestructiveClick(at('Code', 'Clear')).what, 'destructive_action');
  assert.equal(classifyDestructiveClick(at('CalculatorApp', 'Удалить журнал')).what, 'destructive_action', 'strong word in Calculator still needs consent');
  assert.equal(classifyDestructiveKeys('enter', {elem: {controlType: 'Button', name: 'Очистить'}, focused: {process: 'CalculatorApp'}}), null);
  assert.equal(classifyDestructiveKeys('enter', {elem: {controlType: 'Button', name: 'Очистить'}, focused: {process: 'mspaint'}}).what, 'destructive_action');
});

test('NX-052-28: a confirmation dialog in Calculator keeps the dialog rules', () => {
  const r = classifyDestructiveClick({process: 'CalculatorApp', elem: {controlType: 'Button', name: 'Yes'}, dialog: {title: 'Delete', text: ['Are you sure?']}});
  assert.equal(r.what, 'destructive_action');
});
