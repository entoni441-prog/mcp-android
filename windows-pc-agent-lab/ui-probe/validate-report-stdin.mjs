#!/usr/bin/env node
/** Offline, bounded PowerShell JSON -> strict UIA result contract.
 * A local pipeline helper: no network API, disk writes or remote commands.
 * stdin only; stdout is sanitized allowlisted JSON, stderr never echoes data.
 */
import {validateUiReport} from './validate-report.mjs';

let input='';
let count=0;
try {
  for await (const chunk of process.stdin) {
    count+=chunk.byteLength;
    if (count>16*1024) throw Error('invalid_uia_report');
    input+=chunk.toString('utf8');
  }
  // The upstream PowerShell script emits exactly one JSON object.
  const result=validateUiReport(input.trim());
  process.stdout.write(JSON.stringify(result)+'\n');
} catch {
  process.stderr.write('invalid_uia_report\n');
  process.exitCode=2;
}
