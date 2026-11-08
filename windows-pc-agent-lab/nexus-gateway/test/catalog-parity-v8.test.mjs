import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LIVE_UI as HOST_LIVE_UI} from '../../nexus-host/catalog.mjs';
import {WIDGET_RESOURCE, widgetContents, LIVE_UI as WIDGET_LIVE_UI} from '../src/widget.mjs';

test('v8 resource URI is gateway-only; shared Host/Gateway catalog bytes remain identical', async () => {
  const host=await readFile(new URL('../../nexus-host/catalog.mjs',import.meta.url));
  const gateway=await readFile(new URL('../src/catalog.mjs',import.meta.url));
  assert.deepEqual(gateway,host,'Host and Gateway catalogs must remain byte-identical');
  assert.equal(HOST_LIVE_UI,'ui://nexus/live-view-v7.html');
  assert.equal(WIDGET_LIVE_UI,'ui://nexus/live-view-v9.html');
  assert.equal(WIDGET_RESOURCE.uri,WIDGET_LIVE_UI);
  assert.equal(widgetContents()[0].uri,WIDGET_LIVE_UI);
});
