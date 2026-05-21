#!/usr/bin/env node
/**
 * Mock Vigil server for development / screenshots.
 *
 * Runs a tiny HTTP server on `:5050` that returns fake-but-realistic JSON
 * for every endpoint the ui-next vigil pages hit. Just enough to make the
 * /admin/vigil/* surfaces show populated tables instead of the offline
 * banner.
 *
 * Usage:
 *   node scripts/mock-vigil.mjs            # listen on 5050
 *   PORT=6060 node scripts/mock-vigil.mjs  # custom port
 *
 * The OJ side needs:
 *   - system setting `vigil.baseUrl`        = http://127.0.0.1:5050
 *   - system setting `vigil.dashboardToken` = any non-empty string
 *
 * Endpoints:
 *   GET  /api/clients
 *   GET  /api/events
 *   GET  /api/approvals
 *   GET  /api/exam-sessions
 *   POST /api/approvals/:id/approve   → 200 {ok:true}
 *   POST /api/approvals/:id/reject    → 200 {ok:true}
 *   POST /api/clients/:id/commands    → 200 {ok:true}
 *   GET  /api/ws/dashboard            → 426 (dashboards reconnect; we don't ws here)
 */
import http from 'node:http';

const PORT = parseInt(process.env.PORT || '5050', 10);

function iso(secAgo) {
  return new Date(Date.now() - secAgo * 1000).toISOString();
}

const CLIENTS = [
  { client_id: 'lab-01', hostname: 'lab-01.cauc.edu', status: 'online',      last_seen_at: iso(8),    exam_session_id: 'sess-1' },
  { client_id: 'lab-02', hostname: 'lab-02.cauc.edu', status: 'online',      last_seen_at: iso(11),   exam_session_id: 'sess-2' },
  { client_id: 'lab-03', hostname: 'lab-03.cauc.edu', status: 'online',      last_seen_at: iso(4),    exam_session_id: 'sess-3' },
  { client_id: 'lab-04', hostname: 'lab-04.cauc.edu', status: 'idle',        last_seen_at: iso(120) },
  { client_id: 'lab-05', hostname: 'lab-05.cauc.edu', status: 'offline',     last_seen_at: iso(900),  exam_session_id: 'sess-4' },
  { client_id: 'lab-06', hostname: 'lab-06.cauc.edu', status: 'online',      last_seen_at: iso(6),    exam_session_id: 'sess-5' },
];

const EVENTS = [
  { event_id: 'e1', client_id: 'lab-02', exam_session_id: 'sess-2', category: 'focus_lost',       severity: 'warning',  message: '考生窗口失焦超过 30 秒',           occurrence_count: 3, status: 'open',     first_seen_at: iso(600),  last_seen_at: iso(60) },
  { event_id: 'e2', client_id: 'lab-05', exam_session_id: 'sess-4', category: 'screen_unlocked',  severity: 'critical', message: '锁屏模式被解除',                    occurrence_count: 1, status: 'open',     first_seen_at: iso(900),  last_seen_at: iso(900) },
  { event_id: 'e3', client_id: 'lab-01', exam_session_id: 'sess-1', category: 'clipboard_paste',  severity: 'info',     message: '检测到剪贴板粘贴',                  occurrence_count: 2, status: 'open',     first_seen_at: iso(180),  last_seen_at: iso(20) },
  { event_id: 'e4', client_id: 'lab-03', exam_session_id: 'sess-3', category: 'usb_attached',     severity: 'warning',  message: 'USB 存储设备插入',                  occurrence_count: 1, status: 'resolved', first_seen_at: iso(1400), last_seen_at: iso(1400) },
  { event_id: 'e5', client_id: 'lab-06', exam_session_id: 'sess-5', category: 'process_spawn',    severity: 'info',     message: '检测到外部进程启动: Chrome',         occurrence_count: 5, status: 'open',     first_seen_at: iso(300),  last_seen_at: iso(5) },
];

const APPROVALS = [
  { id: 'a1', machine_id: 'lab-04', oj_contest_id: '6a0ed7b216fece62079c1a5a', student_id_input: '202301010', real_name_input: '王五', matched_oj_user_id: null, is_unknown: true,  status: 'pending', created_at: iso(120) },
  { id: 'a2', machine_id: 'lab-07', oj_contest_id: '6a0ed7b216fece62079c1a5a', student_id_input: '202301011', real_name_input: '赵六', matched_oj_user_id: 102,  is_unknown: false, status: 'pending', created_at: iso(45) },
  { id: 'a3', machine_id: 'lab-02', oj_contest_id: '6a0ed7b216fece62079c1a5a', student_id_input: '202301002', real_name_input: '李四', matched_oj_user_id: 100,  is_unknown: false, status: 'approved', created_at: iso(800) },
];

const SESSIONS = [
  { id: 'sess-1', machine_id: 'lab-01', oj_user_id: 100, oj_contest_id: '6a0ed7b216fece62079c1a5a', status: 'active', began_at: iso(1800), closed_at: null,         is_temporary_user: false },
  { id: 'sess-2', machine_id: 'lab-02', oj_user_id: 101, oj_contest_id: '6a0ed7b216fece62079c1a5a', status: 'active', began_at: iso(1800), closed_at: null,         is_temporary_user: false },
  { id: 'sess-3', machine_id: 'lab-03', oj_user_id: 102, oj_contest_id: '6a0ed7b216fece62079c1a5a', status: 'active', began_at: iso(1700), closed_at: null,         is_temporary_user: false },
  { id: 'sess-4', machine_id: 'lab-05', oj_user_id: 104, oj_contest_id: '6a0ed7b216fece62079c1a5a', status: 'flagged', began_at: iso(1600), closed_at: null,        is_temporary_user: true },
  { id: 'sess-5', machine_id: 'lab-06', oj_user_id: 103, oj_contest_id: '6a0ed7b216fece62079c1a5a', status: 'active', began_at: iso(1500), closed_at: null,         is_temporary_user: false },
  { id: 'sess-0', machine_id: 'lab-01', oj_user_id: 100, oj_contest_id: '6a0ed7b216fece62079c1a4f', status: 'closed', began_at: iso(8400), closed_at: iso(2400),    is_temporary_user: false },
];

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // CORS for any local OJ origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-KVS-Token,X-Service-Token');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  console.log(`[mock-vigil] ${req.method} ${pathname}`);

  if (req.method === 'GET' && pathname === '/api/clients')       return json(res, 200, CLIENTS);
  if (req.method === 'GET' && pathname === '/api/events')        return json(res, 200, EVENTS);
  if (req.method === 'GET' && pathname === '/api/approvals')     return json(res, 200, APPROVALS);
  if (req.method === 'GET' && pathname === '/api/exam-sessions') return json(res, 200, SESSIONS);

  if (req.method === 'POST' && /^\/api\/approvals\/[^/]+\/(approve|reject)$/.test(pathname)) {
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && /^\/api\/clients\/[^/]+\/commands$/.test(pathname)) {
    return json(res, 200, { ok: true });
  }

  // The ws path — return 426 so the dashboard knows to retry later.
  if (pathname === '/api/ws/dashboard') {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('upgrade required');
    return;
  }

  return json(res, 404, { detail: `mock-vigil: not handled ${pathname}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-vigil] listening at http://127.0.0.1:${PORT}`);
  console.log('[mock-vigil] tip: set vigil.baseUrl + vigil.dashboardToken in OJ system settings');
});
