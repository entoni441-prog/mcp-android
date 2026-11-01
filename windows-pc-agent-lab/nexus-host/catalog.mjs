/**
 * NEXUS 0.4.1 tool catalog — SINGLE SOURCE. nexus-gateway/src/catalog.mjs must be a byte-identical copy
 * (the gateway answers tools/list while the PC is offline); enforced by catalog.test.mjs.
 */
export const VERSION = '0.4.1';
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = {name: 'nexus-host', version: VERSION};
const str = (description) => ({type: 'string', description});
const int = (description, minimum, maximum) => ({type: 'integer', description, minimum, maximum});
const obj = (properties, required = []) => ({type: 'object', properties, ...(required.length ? {required} : {}), additionalProperties: false});
const RO = {readOnlyHint: true};
const PID = int('Process id (from list_windows or list_processes)', 1, 2147483647);
const SP = 'Screen points (same space as capture_screen when imageToScreen=1)';

export const TOOLS = [
  // ── 0.3.0 (unchanged) ──
  {name: 'get_status', description: 'Host status: OS, uptime, memory.', inputSchema: obj({}), annotations: RO},
  {name: 'list_dir', description: 'List a folder inside the NEXUS workspace. path="" is the workspace root; use "/" separators.', inputSchema: obj({path: str('Relative path')}, ['path']), annotations: RO},
  {name: 'read_text', description: 'Read a small UTF-8 text file (≤8 KiB) inside the workspace. Returns text and sha256.', inputSchema: obj({path: str('Relative path')}, ['path']), annotations: RO},
  {name: 'make_dir', description: 'Create one folder inside the workspace.', inputSchema: obj({path: str('Relative path')}, ['path'])},
  {name: 'write_text', description: 'Create (expectedSha256=null) or replace (expectedSha256=current sha256) a small text file inside the workspace.', inputSchema: obj({path: str('Relative path'), content: str('UTF-8 text ≤8 KiB'), expectedSha256: {type: ['string', 'null']}}, ['path', 'content', 'expectedSha256'])},
  {name: 'open_app', description: 'Open an allowlisted Windows app on the owner\'s desktop.', inputSchema: obj({app: {type: 'string', enum: ['notepad', 'calculator']}}, ['app'])},
  {name: 'list_windows', description: 'List top-level windows open on the owner\'s Windows desktop (read-only). Returns pid and process name; window titles only when includeTitles=true (titles may contain personal data).', inputSchema: obj({includeTitles: {type: 'boolean', description: 'Also return window titles. Default false.'}}), annotations: RO},
  // ── 0.4.0 GUI ──
  {name: 'image_selftest', description: 'Diagnostic: returns a 64x64 test PNG (four coloured squares) to check that images reach the model.', inputSchema: obj({}), annotations: RO},
  {name: 'capture_screen', description: 'Screenshot of the primary screen as PNG. Shows everything visible. Returns imageToScreen: multiply image pixel coordinates by it to get screen points for mouse_action.', inputSchema: obj({maxWidth: int('Max image width, default 1568', 320, 2560), saveToWorkspace: {type: 'boolean', description: 'Also save PNG into workspace/screenshots'}}), annotations: RO},
  {name: 'focus_window', description: 'Bring an allowlisted app window (default: Notepad, Calculator) to the foreground and confirm it really is focused.', inputSchema: obj({pid: PID}, ['pid'])},
  {name: 'window_info', description: 'Windows of an allowlisted app: name, class, rectangle in screen points, whether focused.', inputSchema: obj({pid: PID}, ['pid']), annotations: RO},
  {name: 'inspect_ui', description: 'UI Automation control tree of an allowlisted app window: type, name, automation id, rectangle (screen points), enabled.', inputSchema: obj({pid: PID, maxDepth: int('Default 4', 1, 8), maxNodes: int('Default 150', 1, 400)}, ['pid']), annotations: RO},
  {name: 'mouse_action', description: `Mouse in an allowlisted app only (refused if the element under the point belongs to another app). ${SP}. Requires owner capability gui_input.`, inputSchema: obj({action: {type: 'string', enum: ['move', 'click', 'double_click', 'right_click', 'scroll', 'drag']}, x: int('X', -20000, 20000), y: int('Y', -20000, 20000), x2: int('Drag end X', -20000, 20000), y2: int('Drag end Y', -20000, 20000), amount: int('Scroll notches (+down)', -20, 20)}, ['action', 'x', 'y'])},
  {name: 'keyboard_action', description: 'Type text (via clipboard paste) or press one key chord (e.g. "ctrl+s", "enter") into the focused allowlisted app. Exactly one of text/keys. Windows key and Ctrl+Alt chords are refused. Requires capability gui_input.', inputSchema: obj({text: str('Text to paste, ≤4000 chars'), keys: str('Chord: [ctrl+][shift+][alt+]key; key = a-z 0-9 enter tab esc backspace delete space arrows home end pageup pagedown f1-f12')})},
  // ── 0.4.0 processes / tasks / audit ──
  {name: 'list_processes', description: 'Running processes (name, pid, memory). Read-only.', inputSchema: obj({nameFilter: str('Substring filter'), limit: int('Default 200', 1, 500)}), annotations: RO},
  {name: 'process_action', description: 'close = polite close of an allowlisted app or NEXUS-started process; kill = force stop, only processes NEXUS started. Requires capability process_control.', inputSchema: obj({pid: PID, action: {type: 'string', enum: ['close', 'kill']}}, ['pid', 'action'])},
  {name: 'run_task', description: 'Start a task the owner predefined in capabilities.json (fixed program + arguments). No arbitrary commands. Returns an id; poll task_status.', inputSchema: obj({task: str('Task name')}, ['task'])},
  {name: 'task_status', description: 'Without id: list tasks and available task names. With id: state, exit code, output tail.', inputSchema: obj({id: str('Task id')}), annotations: RO},
  {name: 'task_cancel', description: 'Stop a running task started by run_task.', inputSchema: obj({id: str('Task id')}, ['id'])},
  {name: 'read_audit_log', description: 'Last entries of the NEXUS Host audit log.', inputSchema: obj({lines: int('Default 50', 1, 200)}), annotations: RO},
  // ── 0.4.0 workspace files ──
  {name: 'search_files', description: 'Find files/folders by name substring inside the workspace.', inputSchema: obj({query: str('Name substring'), path: str('Start folder, "" = root'), maxResults: int('Default 100', 1, 200)}, ['query']), annotations: RO},
  {name: 'file_action', description: 'copy / move / rename / delete inside the workspace. Never overwrites. delete moves into .nexus-trash (recoverable). rename: "to" is a new name in the same folder.', inputSchema: obj({action: {type: 'string', enum: ['copy', 'move', 'rename', 'delete']}, path: str('Relative source path'), to: str('Relative destination path (copy/move) or new name (rename)')}, ['action', 'path'])},
  // ── 0.4.1 permission switches (live, no restart) ──
  {name: 'get_capabilities', description: 'Current NEXUS permission switches (screen_capture, ui_read, gui_input, process_control, run_task, browser), allowlisted input apps, task names, and whether capabilities.json has an error.', inputSchema: obj({}), annotations: RO},
  {name: 'set_capability', description: 'Switch mouse/keyboard control (gui_input) on or off immediately, without restarting NEXUS. Call ONLY when the owner explicitly asked for it in this chat ("включи ввод" / "выключи ввод"). Every change is recorded in the audit log. Other permissions can only be changed by the owner on the PC.', inputSchema: obj({capability: {type: 'string', enum: ['gui_input']}, enabled: {type: 'boolean'}}, ['capability', 'enabled'])},
  // ── 0.4.0 browser (separate Edge profile) ──
  {name: 'browser_open', description: 'Open a public http(s) URL in NEXUS\'s own Edge window (separate profile, no owner cookies). Local/private addresses refused. Requires capability browser.', inputSchema: obj({url: str('http(s) URL')}, ['url'])},
  {name: 'browser_snapshot', description: 'Current page: url, title, visible text (≤6000 chars) and interactive elements with refs (e1, e2…) for browser_action. Optional JPEG screenshot.', inputSchema: obj({screenshot: {type: 'boolean'}}), annotations: RO},
  {name: 'browser_action', description: 'Act on the NEXUS browser page: click/type (ref from latest snapshot), press (Enter, Tab, Escape, Backspace, Arrow*, PageUp/Down, Home, End, Space), navigate, back, scroll. Password fields refused.', inputSchema: obj({action: {type: 'string', enum: ['click', 'type', 'press', 'navigate', 'back', 'scroll']}, ref: str('Element ref, e.g. e12'), text: str('Text for type'), clear: {type: 'boolean', description: 'Clear field before typing'}, key: str('Key for press'), url: str('URL for navigate'), amount: int('Scroll screens (+down)', -20, 20)}, ['action'])},
];
