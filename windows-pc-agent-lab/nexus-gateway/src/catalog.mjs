/**
 * MCP catalog served by the gateway itself, so ChatGPT can initialize and list tools while the PC is offline.
 * Must equal NEXUS Host's tools/list — enforced by nexus-host/e2e-gateway.test.mjs.
 */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = {name: 'nexus-host', version: '0.3.0'};
const str = (description) => ({type: 'string', description});
export const TOOLS = [
  {name: 'get_status', description: 'Host status: OS, uptime, memory.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true}},
  {name: 'list_dir', description: 'List a folder inside the NEXUS workspace. path="" is the workspace root; use "/" separators.', inputSchema: {type: 'object', properties: {path: str('Relative path')}, required: ['path'], additionalProperties: false}, annotations: {readOnlyHint: true}},
  {name: 'read_text', description: 'Read a small UTF-8 text file (≤8 KiB) inside the workspace. Returns text and sha256.', inputSchema: {type: 'object', properties: {path: str('Relative path')}, required: ['path'], additionalProperties: false}, annotations: {readOnlyHint: true}},
  {name: 'make_dir', description: 'Create one folder inside the workspace.', inputSchema: {type: 'object', properties: {path: str('Relative path')}, required: ['path'], additionalProperties: false}},
  {name: 'write_text', description: 'Create (expectedSha256=null) or replace (expectedSha256=current sha256) a small text file inside the workspace.', inputSchema: {type: 'object', properties: {path: str('Relative path'), content: str('UTF-8 text ≤8 KiB'), expectedSha256: {type: ['string', 'null']}}, required: ['path', 'content', 'expectedSha256'], additionalProperties: false}},
  {name: 'open_app', description: 'Open an allowlisted Windows app on the owner\'s desktop.', inputSchema: {type: 'object', properties: {app: {type: 'string', enum: ['notepad', 'calculator']}}, required: ['app'], additionalProperties: false}},
  {name: 'list_windows', description: 'List top-level windows open on the owner\'s Windows desktop (read-only). Returns pid and process name; window titles only when includeTitles=true (titles may contain personal data).', inputSchema: {type: 'object', properties: {includeTitles: {type: 'boolean', description: 'Also return window titles. Default false.'}}, additionalProperties: false}, annotations: {readOnlyHint: true}},
];
