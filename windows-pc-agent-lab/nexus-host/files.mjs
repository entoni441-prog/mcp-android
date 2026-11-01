/**
 * NEXUS Host 0.4.0 — workspace file tools (reuse the audited path checks of v3/actions.mjs).
 *  search_files  name substring search inside the workspace (no symlinks, bounded walk)
 *  file_action   copy | move | rename | delete — never overwrites; delete = move into .nexus-trash (recoverable)
 */
import fs from 'node:fs';
import path from 'node:path';
import {safePath, requireRoot, targetPath} from '../v3/actions.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = () => { throw Error('invalid_args'); };
const TRASH = '.nexus-trash';
const MAX_COPY = 50 * 1024 * 1024;

export function searchFiles(args, {workspace}) {
  if (!onlyKeys(args, ['query', 'path', 'maxResults'])) bad();
  if (typeof args.query !== 'string' || args.query.length < 1 || args.query.length > 100) bad();
  const rel = args.path ?? '';
  if (rel !== '' && !safePath(rel)) bad();
  const max = args.maxResults ?? 100;
  if (!Number.isInteger(max) || max < 1 || max > 200) bad();
  const root = requireRoot(workspace);
  const start = targetPath(root, rel, true);
  const q = args.query.toLowerCase();
  const results = []; let scanned = 0, truncated = false;
  const walk = (dir, depth) => {
    if (depth > 8 || truncated) return;
    let entries; try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      if (++scanned > 5000 || results.length >= max) { truncated = true; return; }
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const r = path.relative(root, full).split(path.sep).join('/');
      if (r === TRASH || r.startsWith(TRASH + '/')) continue;
      if (e.name.toLowerCase().includes(q)) {
        const st = fs.lstatSync(full);
        results.push({path: r, type: e.isDirectory() ? 'dir' : 'file', size: e.isFile() ? st.size : null, modified: st.mtime.toISOString()});
      }
      if (e.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(start, 0);
  return {query: args.query, results, truncated, scanned};
}

export function fileAction(args, {workspace, now = () => new Date()}) {
  if (!onlyKeys(args, ['action', 'path', 'to'])) bad();
  if (!['copy', 'move', 'rename', 'delete'].includes(args.action) || !safePath(args.path)) bad();
  if (args.action === 'delete' ? args.to !== undefined : !safePath(args.to)) bad();
  if (args.path === TRASH || args.path.startsWith(TRASH + '/')) throw Error('trash_protected');
  if (args.to && (args.to === TRASH || args.to.startsWith(TRASH + '/'))) throw Error('trash_protected');
  const root = requireRoot(workspace);
  const src = targetPath(root, args.path);
  if (!fs.existsSync(src)) throw Error('not_found');
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) throw Error('symlink_forbidden');

  if (args.action === 'rename' && args.to.includes('/')) throw Error('rename_takes_a_name'); // name only, same folder
  let destRel = args.action === 'rename' ? [...args.path.split('/').slice(0, -1), args.to].join('/') : args.to;
  if (args.action === 'delete') {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    destRel = `${TRASH}/${stamp}-${path.basename(src)}`;
    fs.mkdirSync(path.join(root, TRASH), {recursive: true});
  }
  const dest = targetPath(root, destRel);
  if (fs.existsSync(dest)) throw Error('destination_exists');
  if (dest === src || dest.startsWith(src + path.sep)) throw Error('destination_inside_source');
  if (!fs.existsSync(path.dirname(dest))) throw Error('destination_folder_missing');

  if (args.action === 'copy') {
    if (!st.isFile()) throw Error('copy_files_only');
    if (st.size > MAX_COPY) throw Error('file_too_large');
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  } else {
    fs.renameSync(src, dest);
  }
  return {action: args.action, from: args.path, to: destRel, recoverable: args.action === 'delete'};
}
