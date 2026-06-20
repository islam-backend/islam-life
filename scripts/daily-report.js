// Nightly report — pulls today's progress + tomorrow's plan from Firestore and
// delivers it to Telegram and Gmail. Designed to run from GitHub Actions Cron.
//
// Required env vars (set as repo secrets):
//   FIREBASE_SERVICE_ACCOUNT  — full JSON of a Firebase Admin service account
//   TELEGRAM_BOT_TOKEN        — bot token from @BotFather
//   TELEGRAM_CHAT_ID          — your personal chat id (numeric)
//   GMAIL_USER                — Gmail address used as sender
//   GMAIL_APP_PASSWORD        — 16-char Gmail App Password (NOT account password)
//   GMAIL_TO                  — destination address (defaults to GMAIL_USER)
//
// Optional:
//   REPORT_TIMEZONE           — IANA tz, defaults to "Africa/Cairo"

import admin from 'firebase-admin';
import nodemailer from 'nodemailer';

const TZ = process.env.REPORT_TIMEZONE || 'Africa/Cairo';

// GitHub Actions cron can be delayed by 1-3 hours. If the workflow fires just
// after midnight, `new Date()` lands on the next calendar day and the report
// would describe "tomorrow" as if it were today. Anchoring 6 hours back keeps
// us inside the day that just ended even with worst-case delays.
const ANCHOR_OFFSET_HOURS = 6;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function initFirebase() {
  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT');
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  return admin.firestore();
}

function ymdInTZ(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t).value;
  return { year: +get('year'), month: +get('month'), day: +get('day') };
}

function startOfLocalDay(date) {
  const { year, month, day } = ymdInTZ(date);
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = tzOffsetMinutes(new Date(utc));
    utc = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMin * 60_000;
  }
  return new Date(utc);
}

function tzOffsetMinutes(instant) {
  const local = new Date(instant.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60_000);
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 24 * 60 * 60 * 1000);
}

function addHours(date, n) {
  return new Date(date.getTime() + n * 60 * 60 * 1000);
}

function ymdKey(date) {
  const { year, month, day } = ymdInTZ(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fmtDate(date) {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}

function fmtTime(date) {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function taskCoversDay(task, dayStart) {
  const sd = toDate(task.startDate);
  if (!sd) return false;
  const ed = toDate(task.endDate) || sd;
  const sStart = startOfLocalDay(sd).getTime();
  const eStart = startOfLocalDay(ed).getTime();
  const tStart = dayStart.getTime();
  return tStart >= sStart && tStart <= eStart;
}

async function loadAll(db) {
  const [clientsSnap, projectsSnap, tasksSnap] = await Promise.all([
    db.collection('clients').get(),
    db.collectionGroup('projects').get(),
    db.collectionGroup('tasks').get(),
  ]);

  const clients = new Map();
  clientsSnap.forEach(d => clients.set(d.id, { id: d.id, ...d.data() }));

  const projects = new Map();
  projectsSnap.forEach(d => {
    const cId = d.ref.parent.parent.id;
    projects.set(d.id, { id: d.id, _clientId: cId, ...d.data() });
  });

  const tasks = [];
  tasksSnap.forEach(d => {
    const pRef = d.ref.parent.parent;
    const cRef = pRef.parent.parent;
    tasks.push({
      id: d.id,
      _projectId: pRef.id,
      _clientId: cRef.id,
      ...d.data(),
    });
  });

  return { clients, projects, tasks };
}

async function loadFocusForDay(db, dayKey) {
  const snap = await db.collection('focusSessions').where('day', '==', dayKey).get();
  const sessions = [];
  snap.forEach(d => sessions.push({ id: d.id, ...d.data() }));
  return sessions;
}

function projectLabel(projects, clients, projectId) {
  const p = projects.get(projectId);
  if (!p) return 'مشروع غير معروف';
  const c = clients.get(p._clientId);
  return `${p.name || '—'}${c ? ` · ${c.name}` : ''}`;
}

function clientNameFor(projects, clients, projectId) {
  const p = projects.get(projectId);
  if (!p) return '—';
  const c = clients.get(p._clientId);
  return c?.name || '—';
}

function projectNameFor(projects, projectId) {
  const p = projects.get(projectId);
  return p?.name || '—';
}

function priorityMeta(p) {
  switch (p) {
    case 'high':   return { label: 'عالية', color: '#DC2626', bg: '#FEE2E2' };
    case 'medium': return { label: 'متوسطة', color: '#D97706', bg: '#FEF3C7' };
    case 'low':    return { label: 'منخفضة', color: '#059669', bg: '#D1FAE5' };
    default:       return null;
  }
}

function statusMeta(s) {
  switch (s) {
    case 'doing': return { label: 'قيد التنفيذ', color: '#D97706', bg: '#FEF3C7', icon: '🟡' };
    case 'todo':  return { label: 'لم تبدأ',     color: '#2563EB', bg: '#DBEAFE', icon: '🔵' };
    case 'done':  return { label: 'مكتملة',      color: '#059669', bg: '#D1FAE5', icon: '✅' };
    default:      return { label: '—',           color: '#6B7280', bg: '#F3F4F6', icon: '•' };
  }
}

function buildReport({ clients, projects, tasks, focusSessions, anchor }) {
  const todayStart = startOfLocalDay(anchor);
  const tomorrowStart = startOfLocalDay(addDays(anchor, 1));
  const todayEnd = addDays(todayStart, 1);

  const doneToday = tasks.filter(t => {
    if (t.status !== 'done') return false;
    const cAt = toDate(t.completedAt);
    if (!cAt) return false;
    return cAt >= todayStart && cAt < todayEnd;
  }).sort((a, b) => {
    const ta = toDate(a.completedAt)?.getTime() || 0;
    const tb = toDate(b.completedAt)?.getTime() || 0;
    return ta - tb;
  });

  const todayPlanned = tasks.filter(t => taskCoversDay(t, todayStart));
  const todayNotDone = todayPlanned.filter(t => t.status !== 'done');
  const inProgress = tasks.filter(t => t.status === 'doing');

  const tomorrowTasks = tasks
    .filter(t => t.status !== 'done' && taskCoversDay(t, tomorrowStart))
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
    });

  const overdue = tasks.filter(t => {
    if (t.status === 'done') return false;
    const ed = toDate(t.endDate) || toDate(t.startDate);
    if (!ed) return false;
    return startOfLocalDay(ed).getTime() < todayStart.getTime();
  }).sort((a, b) => {
    const ea = toDate(a.endDate) || toDate(a.startDate);
    const eb = toDate(b.endDate) || toDate(b.startDate);
    return (ea?.getTime() || 0) - (eb?.getTime() || 0);
  });

  const focusByProject = new Map();
  const focusByClient = new Map();
  let totalMinutes = 0;
  for (const s of focusSessions) {
    const mins = s.minutes || 0;
    totalMinutes += mins;
    focusByProject.set(s.projectId, (focusByProject.get(s.projectId) || 0) + mins);
    const cId = projects.get(s.projectId)?._clientId;
    if (cId) focusByClient.set(cId, (focusByClient.get(cId) || 0) + mins);
  }

  const doneByClient = new Map();
  const doneByProject = new Map();
  for (const t of doneToday) {
    doneByProject.set(t._projectId, (doneByProject.get(t._projectId) || 0) + 1);
    doneByClient.set(t._clientId, (doneByClient.get(t._clientId) || 0) + 1);
  }

  const tomorrowByProject = new Map();
  for (const t of tomorrowTasks) {
    if (!tomorrowByProject.has(t._projectId)) tomorrowByProject.set(t._projectId, []);
    tomorrowByProject.get(t._projectId).push(t);
  }

  const doneByProjectGroup = new Map();
  for (const t of doneToday) {
    if (!doneByProjectGroup.has(t._projectId)) doneByProjectGroup.set(t._projectId, []);
    doneByProjectGroup.get(t._projectId).push(t);
  }

  const completionRate = todayPlanned.length
    ? Math.round((doneToday.length / todayPlanned.length) * 100)
    : null;

  return {
    todayStart, tomorrowStart,
    doneToday, doneByProjectGroup,
    todayPlanned, todayNotDone, inProgress,
    tomorrowTasks, tomorrowByProject,
    overdue,
    totalMinutes,
    focusByProject, focusByClient,
    doneByClient, doneByProject,
    completionRate,
  };
}

function fmtHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}س ${m}د`;
  if (h) return `${h}س`;
  return `${m}د`;
}

function daysOverdue(task, todayStart) {
  const ed = toDate(task.endDate) || toDate(task.startDate);
  if (!ed) return 0;
  const diff = todayStart.getTime() - startOfLocalDay(ed).getTime();
  return Math.max(0, Math.round(diff / (24 * 60 * 60 * 1000)));
}

// ---------- Telegram ----------

function escapeMd(s) {
  return String(s ?? '').replace(/([_*`\[\]])/g, '\\$1');
}

// ASCII bar: fills `filled` out of `total` blocks (width=10)
function asciiBar(value, max, width = 10) {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// Completion ring from percentage: ◉ full, ◎ empty, segments at 8
function completionRing(pct) {
  const total = 8;
  const filled = Math.round((pct / 100) * total);
  const ring = [];
  for (let i = 0; i < total; i++) ring.push(i < filled ? '●' : '○');
  // top row: 3 chars, mid rows: 1+space+1, bottom: 3
  const [a,b,c,d,e,f,g,h] = ring;
  return [
    ` ${a}${b}${c} `,
    `${h}   ${d}`,
    `${g}   ${e}`,
    ` ${f}${f}${f} `,  // bottom arc placeholder
  ].join('\n');
}

function formatTelegram(r, { clients, projects, reportDay }) {
  const lines = [];

  // ── Header ──
  lines.push(`🌙 *ملخص اليوم*`);
  lines.push(`📅 _${escapeMd(fmtDate(reportDay))}_`);
  lines.push('');

  // ── Visual dashboard card ──
  const pct = r.completionRate ?? 0;
  const pctBar = asciiBar(pct, 100, 12);
  const overdueCount = r.overdue.length;
  const inProgressCount = r.inProgress.length;

  lines.push('```');
  lines.push(`┌─────────────────────────┐`);
  lines.push(`│  ✅  ${String(r.doneToday.length).padStart(3)}  منجزة اليوم      │`);
  lines.push(`│  ⏳  ${String(inProgressCount).padStart(3)}  جاري التنفيذ    │`);
  lines.push(`│  ⏱   ${String(fmtHours(r.totalMinutes)).padEnd(5)} تركيز فعلي  │`);
  if (overdueCount > 0)
    lines.push(`│  🔴  ${String(overdueCount).padStart(3)}  متأخرة ⚠️          │`);
  lines.push(`├─────────────────────────┤`);
  lines.push(`│  إنجاز  ${pctBar}  ${String(pct).padStart(3)}%  │`);
  lines.push(`└─────────────────────────┘`);
  lines.push('```');
  lines.push('');

  // ── Focus bar chart ──
  if (r.focusByProject.size > 0) {
    lines.push(`⏱ *توزيع التركيز*`);
    lines.push('```');
    const sorted = [...r.focusByProject.entries()].sort((a, b) => b[1] - a[1]);
    for (const [pid, mins] of sorted.slice(0, 5)) {
      const name = projectNameFor(projects, pid);
      const pctF = r.totalMinutes ? Math.round((mins / r.totalMinutes) * 100) : 0;
      const bar = asciiBar(mins, r.totalMinutes, 8);
      const label = name.length > 10 ? name.slice(0, 9) + '…' : name.padEnd(10);
      lines.push(`${label}  ${bar}  ${fmtHours(mins)}`);
    }
    lines.push('```');
    lines.push('');
  }

  // ── Done today — compact ──
  if (r.doneToday.length > 0) {
    lines.push(`✅ *منجزات اليوم* _(${r.doneToday.length})_`);
    for (const [pid, list] of r.doneByProjectGroup) {
      lines.push(`📌 _${escapeMd(projectLabel(projects, clients, pid))}_`);
      for (const t of list) {
        const time = toDate(t.completedAt);
        const timeStr = time ? ` _(${escapeMd(fmtTime(time))})_` : '';
        lines.push(`  ✓ ${escapeMd(t.title || '—')}${timeStr}`);
      }
    }
    lines.push('');
  }

  // ── Tomorrow ──
  const tomorrow = addDays(reportDay, 1);
  lines.push(`📅 *مهام الغد* — ${escapeMd(fmtDate(tomorrow).split(' ').slice(0,2).join(' '))}`);
  if (r.tomorrowTasks.length === 0) {
    lines.push('_لا توجد مهام مجدولة_');
  } else {
    const grouped = new Map();
    for (const t of r.tomorrowTasks) {
      if (!grouped.has(t._projectId)) grouped.set(t._projectId, []);
      grouped.get(t._projectId).push(t);
    }
    for (const [pid, list] of grouped) {
      lines.push(`📌 _${escapeMd(projectLabel(projects, clients, pid))}_`);
      for (const t of list) {
        const icon = statusMeta(t.status).icon;
        const pm = priorityMeta(t.priority);
        const prio = pm ? ` ${pm.label === 'عالية' ? '🔴' : pm.label === 'متوسطة' ? '🟡' : '🟢'}` : '';
        lines.push(`  ${icon} ${escapeMd(t.title || '—')}${prio}`);
      }
    }
  }
  lines.push('');

  // ── Overdue — compact ──
  if (r.overdue.length > 0) {
    lines.push(`⚠️ *متأخرة* _(${r.overdue.length})_`);
    for (const t of r.overdue.slice(0, 5)) {
      const days = daysOverdue(t, r.todayStart);
      lines.push(`  🔴 ${escapeMd(t.title || '—')} _${days}ي_`);
    }
    if (r.overdue.length > 5) lines.push(`  _…و ${r.overdue.length - 5} أخرى_`);
  }

  return lines.join('\n');
}

// ---------- Email ----------

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEmailHtml(r, { clients, projects, reportDay }) {
  const tomorrow = addDays(reportDay, 1);

  // ---------- Reusable bits ----------
  const C = {
    bg: '#F8FAFC',
    card: '#FFFFFF',
    border: '#E5E7EB',
    text: '#111827',
    subtext: '#6B7280',
    muted: '#9CA3AF',
    accent: '#4F46E5',
    accentSoft: '#EEF2FF',
    success: '#059669',
    successSoft: '#D1FAE5',
    warning: '#D97706',
    warningSoft: '#FEF3C7',
    danger: '#DC2626',
    dangerSoft: '#FEE2E2',
    info: '#2563EB',
    infoSoft: '#DBEAFE',
  };

  const tdBase = `font-family:'Segoe UI',Tahoma,Geneva,Verdana,Arial,sans-serif;color:${C.text};`;

  const statCard = (label, value, color, sub = '') => `
    <td valign="top" align="center" style="padding:8px;width:25%;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.border};border-radius:12px;">
        <tr>
          <td align="center" style="${tdBase}padding:18px 8px;">
            <div style="font-size:11px;color:${C.subtext};margin-bottom:6px;font-weight:600;letter-spacing:.3px;">${escapeHtml(label)}</div>
            <div style="font-size:26px;color:${color};font-weight:800;line-height:1;">${escapeHtml(value)}</div>
            ${sub ? `<div style="font-size:11px;color:${C.muted};margin-top:6px;">${escapeHtml(sub)}</div>` : ''}
          </td>
        </tr>
      </table>
    </td>`;

  const sectionCard = (title, subtitle, body, accent = C.accent) => `
    <tr>
      <td style="padding:0 0 16px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.border};border-radius:14px;overflow:hidden;">
          <tr>
            <td style="${tdBase}padding:18px 22px 14px 22px;border-bottom:1px solid ${C.border};">
              <div style="display:inline-block;width:4px;height:18px;background:${accent};border-radius:3px;vertical-align:middle;margin-left:10px;"></div>
              <span style="font-size:17px;font-weight:700;color:${C.text};vertical-align:middle;">${title}</span>
              ${subtitle ? `<div style="font-size:12px;color:${C.subtext};margin-top:4px;padding-right:14px;">${subtitle}</div>` : ''}
            </td>
          </tr>
          <tr><td style="${tdBase}padding:16px 22px 20px 22px;">${body}</td></tr>
        </table>
      </td>
    </tr>`;

  const emptyMsg = (msg) => `
    <div style="text-align:center;padding:14px 0;color:${C.muted};font-size:13px;">${escapeHtml(msg)}</div>`;

  const taskItem = ({ title, project, client, time, priority, status, extra }) => {
    const pm = priority ? priorityMeta(priority) : null;
    const sm = status ? statusMeta(status) : null;
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
        <tr>
          <td style="${tdBase}background:${C.bg};border:1px solid ${C.border};border-radius:10px;padding:12px 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="${tdBase}vertical-align:top;">
                  <div style="font-size:14px;font-weight:600;color:${C.text};line-height:1.5;">${escapeHtml(title)}</div>
                  ${project ? `<div style="font-size:12px;color:${C.subtext};margin-top:4px;">${escapeHtml(project)}${client ? ` <span style="color:${C.muted}">·</span> ${escapeHtml(client)}` : ''}</div>` : ''}
                </td>
                <td style="${tdBase}vertical-align:top;text-align:left;white-space:nowrap;padding-right:8px;">
                  ${time ? `<div style="font-size:11px;color:${C.muted};margin-bottom:4px;">${escapeHtml(time)}</div>` : ''}
                  ${pm ? `<span style="display:inline-block;font-size:10px;font-weight:700;color:${pm.color};background:${pm.bg};padding:3px 8px;border-radius:6px;margin-bottom:4px;">${escapeHtml(pm.label)}</span>` : ''}
                  ${sm && status !== 'done' ? `<span style="display:inline-block;font-size:10px;font-weight:700;color:${sm.color};background:${sm.bg};padding:3px 8px;border-radius:6px;margin-right:4px;">${escapeHtml(sm.label)}</span>` : ''}
                </td>
              </tr>
              ${extra ? `<tr><td colspan="2" style="${tdBase}padding-top:6px;font-size:12px;color:${C.danger};">${extra}</td></tr>` : ''}
            </table>
          </td>
        </tr>
      </table>`;
  };

  const projectGroup = (projectId, tasksList, itemFn) => {
    const pName = projectNameFor(projects, projectId);
    const cName = clientNameFor(projects, clients, projectId);
    return `
      <div style="margin-bottom:14px;">
        <div style="${tdBase}font-size:12px;font-weight:700;color:${C.accent};background:${C.accentSoft};padding:6px 12px;border-radius:8px;margin-bottom:8px;display:inline-block;">
          📌 ${escapeHtml(pName)} <span style="color:${C.muted};font-weight:500;">·</span> <span style="color:${C.subtext};font-weight:500;">${escapeHtml(cName)}</span>
          <span style="color:${C.muted};font-weight:500;margin-right:6px;">(${tasksList.length})</span>
        </div>
        ${tasksList.map(itemFn).join('')}
      </div>`;
  };

  // ---------- Stat cards ----------
  const statsRow = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
      <tr>
        ${statCard('منجزة اليوم', String(r.doneToday.length), C.success)}
        ${statCard('وقت التركيز', fmtHours(r.totalMinutes), C.warning)}
        ${statCard('مهام الغد', String(r.tomorrowTasks.length), C.info)}
        ${statCard('متأخرة', String(r.overdue.length), r.overdue.length ? C.danger : C.muted)}
      </tr>
    </table>`;

  // ---------- Progress bar (today's completion) ----------
  const progressSection = r.todayPlanned.length > 0 ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.border};border-radius:14px;margin-bottom:18px;">
      <tr><td style="${tdBase}padding:18px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="${tdBase}">
              <div style="font-size:13px;color:${C.subtext};font-weight:600;">معدل الإنجاز اليومي</div>
            </td>
            <td style="${tdBase}text-align:left;">
              <span style="font-size:18px;font-weight:800;color:${C.success};">${r.completionRate}%</span>
              <span style="font-size:12px;color:${C.muted};">(${r.doneToday.length}/${r.todayPlanned.length})</span>
            </td>
          </tr>
        </table>
        <div style="margin-top:10px;background:${C.bg};border-radius:10px;height:10px;overflow:hidden;">
          <div style="background:${C.success};height:10px;width:${r.completionRate}%;border-radius:10px;"></div>
        </div>
      </td></tr>
    </table>` : '';

  // ---------- Done today body ----------
  const doneBody = r.doneToday.length === 0
    ? emptyMsg('لم يتم إغلاق أي مهمة اليوم')
    : [...r.doneByProjectGroup.entries()].map(([pid, list]) =>
        projectGroup(pid, list, t => taskItem({
          title: t.title || '—',
          project: '', client: '',
          time: toDate(t.completedAt) ? fmtTime(toDate(t.completedAt)) : '',
          priority: t.priority,
          status: 'done',
        }))
      ).join('');

  // ---------- Focus body ----------
  const focusBody = (() => {
    if (r.focusByProject.size === 0) {
      return emptyMsg('لم يتم تسجيل أي جلسة بومودورو اليوم');
    }
    const sorted = [...r.focusByProject.entries()].sort((a, b) => b[1] - a[1]);
    const rows = sorted.map(([pid, mins]) => {
      const pct = r.totalMinutes ? Math.round((mins / r.totalMinutes) * 100) : 0;
      return `
        <tr>
          <td style="${tdBase}padding:10px 0;border-bottom:1px solid ${C.border};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="${tdBase}font-size:13px;font-weight:600;color:${C.text};">
                  ${escapeHtml(projectNameFor(projects, pid))}
                  <div style="font-size:11px;color:${C.subtext};margin-top:2px;font-weight:500;">${escapeHtml(clientNameFor(projects, clients, pid))}</div>
                </td>
                <td style="${tdBase}text-align:left;white-space:nowrap;">
                  <span style="font-size:14px;font-weight:700;color:${C.warning};">${escapeHtml(fmtHours(mins))}</span>
                  <span style="font-size:11px;color:${C.muted};margin-right:4px;">${pct}%</span>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="${tdBase}padding-top:6px;">
                  <div style="background:${C.bg};border-radius:6px;height:6px;overflow:hidden;">
                    <div style="background:${C.warning};height:6px;width:${pct}%;"></div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    }).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
  })();

  // ---------- Tomorrow body ----------
  const tomorrowBody = r.tomorrowTasks.length === 0
    ? emptyMsg('لا توجد مهام مجدولة للغد — يوم خفيف 🌿')
    : [...r.tomorrowByProject.entries()].map(([pid, list]) =>
        projectGroup(pid, list, t => taskItem({
          title: t.title || '—',
          project: '', client: '',
          priority: t.priority,
          status: t.status,
        }))
      ).join('');

  // ---------- Overdue body ----------
  const overdueBody = r.overdue.length === 0
    ? ''
    : r.overdue.map(t => {
        const days = daysOverdue(t, r.todayStart);
        const ed = toDate(t.endDate) || toDate(t.startDate);
        return taskItem({
          title: t.title || '—',
          project: projectNameFor(projects, t._projectId),
          client: clientNameFor(projects, clients, t._projectId),
          priority: t.priority,
          status: t.status,
          extra: `⏰ متأخرة ${days} ${days === 1 ? 'يوم' : 'أيام'}${ed ? ` <span style="color:${C.muted};font-weight:500;">(كانت لـ ${escapeHtml(fmtDate(ed))})</span>` : ''}`,
        });
      }).join('');

  // ---------- In progress body ----------
  const inProgressFiltered = r.inProgress.filter(t => !r.doneToday.some(d => d.id === t.id));
  const inProgressBody = inProgressFiltered.length === 0
    ? ''
    : inProgressFiltered.slice(0, 12).map(t => taskItem({
        title: t.title || '—',
        project: projectNameFor(projects, t._projectId),
        client: clientNameFor(projects, clients, t._projectId),
        priority: t.priority,
        status: t.status,
      })).join('');

  // ---------- Per-client summary (only if multiple clients had activity) ----------
  const clientStats = new Map();
  for (const [cid, count] of r.doneByClient) {
    clientStats.set(cid, { done: count, focus: 0 });
  }
  for (const [cid, mins] of r.focusByClient) {
    if (!clientStats.has(cid)) clientStats.set(cid, { done: 0, focus: 0 });
    clientStats.get(cid).focus = mins;
  }
  const clientRows = [...clientStats.entries()]
    .sort((a, b) => (b[1].focus + b[1].done * 30) - (a[1].focus + a[1].done * 30))
    .map(([cid, s]) => {
      const c = clients.get(cid);
      return `
        <tr>
          <td style="${tdBase}padding:10px 0;border-bottom:1px solid ${C.border};font-size:13px;font-weight:600;color:${C.text};">
            ${escapeHtml(c?.name || '—')}
          </td>
          <td style="${tdBase}padding:10px 0;border-bottom:1px solid ${C.border};text-align:center;font-size:13px;color:${C.success};font-weight:700;">
            ${s.done}
          </td>
          <td style="${tdBase}padding:10px 0;border-bottom:1px solid ${C.border};text-align:left;font-size:13px;color:${C.warning};font-weight:700;">
            ${escapeHtml(s.focus ? fmtHours(s.focus) : '—')}
          </td>
        </tr>`;
    }).join('');

  const clientBreakdown = clientStats.size > 0 ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <th align="right" style="${tdBase}padding:8px 0;border-bottom:2px solid ${C.border};font-size:11px;font-weight:700;color:${C.subtext};letter-spacing:.3px;">العميل</th>
        <th align="center" style="${tdBase}padding:8px 0;border-bottom:2px solid ${C.border};font-size:11px;font-weight:700;color:${C.subtext};letter-spacing:.3px;">مهام منجزة</th>
        <th align="left" style="${tdBase}padding:8px 0;border-bottom:2px solid ${C.border};font-size:11px;font-weight:700;color:${C.subtext};letter-spacing:.3px;">وقت التركيز</th>
      </tr>
      ${clientRows}
    </table>` : emptyMsg('لا يوجد نشاط على أي عميل اليوم');

  // ---------- Assemble ----------
  const header = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
      <tr>
        <td style="${tdBase}background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);border-radius:16px;padding:24px 26px;color:#FFFFFF;">
          <div style="font-size:12px;font-weight:600;opacity:.85;letter-spacing:.5px;">🌙 ملخص نهاية اليوم</div>
          <div style="font-size:24px;font-weight:800;margin-top:6px;line-height:1.3;">${escapeHtml(fmtDate(reportDay))}</div>
          <div style="font-size:13px;opacity:.9;margin-top:8px;">
            ${r.doneToday.length} منجزة · ${escapeHtml(fmtHours(r.totalMinutes))} تركيز
            ${r.completionRate !== null ? ` · ${r.completionRate}% إنجاز` : ''}
          </div>
        </td>
      </tr>
    </table>`;

  const sections = [
    sectionCard(`✅ إنجازات اليوم <span style="color:${C.muted};font-weight:500;">(${r.doneToday.length})</span>`, '', doneBody, C.success),
    sectionCard(`⏱ وقت التركيز اليوم <span style="color:${C.muted};font-weight:500;">— ${escapeHtml(fmtHours(r.totalMinutes))}</span>`, '', focusBody, C.warning),
    sectionCard(`👥 ملخص العملاء`, '', clientBreakdown, C.accent),
    sectionCard(`📅 خطة الغد <span style="color:${C.muted};font-weight:500;">(${r.tomorrowTasks.length})</span>`, escapeHtml(fmtDate(tomorrow)), tomorrowBody, C.info),
  ];
  if (inProgressBody) {
    sections.push(sectionCard(`🟡 قيد التنفيذ <span style="color:${C.muted};font-weight:500;">(${inProgressFiltered.length})</span>`, '', inProgressBody, C.warning));
  }
  if (overdueBody) {
    sections.push(sectionCard(`⚠️ مهام متأخرة <span style="color:${C.muted};font-weight:500;">(${r.overdue.length})</span>`, 'مهام تجاوزت تاريخ انتهائها', overdueBody, C.danger));
  }

  return `<!doctype html>
<html dir="rtl" lang="ar"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير نهاية اليوم</title>
</head>
<body dir="rtl" style="margin:0;padding:0;background:${C.bg};font-family:'Segoe UI',Tahoma,Geneva,Verdana,Arial,sans-serif;direction:rtl;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
    <tr><td align="center" style="padding:28px 16px;" dir="rtl">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px;" dir="rtl">
        <tr><td dir="rtl" style="direction:rtl;text-align:right;">
          ${header}
          ${statsRow}
          ${progressSection}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${sections.join('')}
          </table>
          <div style="${tdBase}text-align:center;color:${C.muted};font-size:11px;margin-top:18px;padding:14px 0;">
            IslamLifeV2 · تقرير تلقائي يُرسل في نهاية كل يوم
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ---------- Senders ----------

async function sendTelegram(text) {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requireEnv('TELEGRAM_CHAT_ID');
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram send failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

async function sendEmail(html, reportDay) {
  const user = requireEnv('GMAIL_USER');
  const pass = requireEnv('GMAIL_APP_PASSWORD');
  const to = process.env.GMAIL_TO || user;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const subject = `🌙 تقرير نهاية اليوم — ${fmtDate(reportDay)}`;
  await transporter.sendMail({ from: user, to, subject, html });
}

async function main() {
  const db = initFirebase();
  const now = new Date();
  // Anchor backwards so a delayed cron firing after midnight still describes
  // the day that just ended, not the day that just began.
  const anchor = addHours(now, -ANCHOR_OFFSET_HOURS);
  const reportDay = startOfLocalDay(anchor);
  const dayKey = ymdKey(reportDay);

  console.log(`[report] now=${now.toISOString()} anchor=${anchor.toISOString()} reportDay=${dayKey}`);

  const [{ clients, projects, tasks }, focusSessions] = await Promise.all([
    loadAll(db),
    loadFocusForDay(db, dayKey),
  ]);

  const r = buildReport({ clients, projects, tasks, focusSessions, anchor });
  const telegramText = formatTelegram(r, { clients, projects, reportDay });
  const emailHtml = formatEmailHtml(r, { clients, projects, reportDay });

  const results = await Promise.allSettled([
    sendTelegram(telegramText),
    sendEmail(emailHtml, reportDay),
  ]);

  let failed = false;
  results.forEach((res, i) => {
    const ch = i === 0 ? 'telegram' : 'gmail';
    if (res.status === 'fulfilled') console.log(`[${ch}] sent`);
    else { console.error(`[${ch}] failed:`, res.reason); failed = true; }
  });
  if (failed) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
