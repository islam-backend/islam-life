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

// Returns { year, month, day } in the report timezone for an arbitrary Date.
function ymdInTZ(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t).value;
  return { year: +get('year'), month: +get('month'), day: +get('day') };
}

// Local day boundary in the report timezone, returned as a UTC Date.
// Cairo is UTC+2 year-round (no DST since 2014; brief 2023 reinstatement aside,
// the IANA db is authoritative — this code stays correct either way because we
// compute the offset for the exact instant).
function startOfLocalDay(date) {
  const { year, month, day } = ymdInTZ(date);
  // Build a candidate midnight in UTC, then correct by the tz's offset at that
  // instant.  Two passes converge for any tz.
  let utc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = tzOffsetMinutes(new Date(utc));
    utc = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMin * 60_000;
  }
  return new Date(utc);
}

function tzOffsetMinutes(instant) {
  // Compute how many minutes TZ is ahead of UTC at `instant`.
  const local = new Date(instant.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 60_000);
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 24 * 60 * 60 * 1000);
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

// Normalize a Firestore field that might be Timestamp | Date | string | null.
function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// `task` is scheduled to span [startDate, endDate]; treat missing endDate as
// a single-day task on startDate. A task is "on" the day if the day falls in
// the inclusive span.
function taskCoversDay(task, dayStart, dayEnd) {
  const sd = toDate(task.startDate);
  if (!sd) return false;
  const ed = toDate(task.endDate) || sd;
  // Compare day-only: pull each endpoint into its local-day boundary.
  const sStart = startOfLocalDay(sd).getTime();
  const eStart = startOfLocalDay(ed).getTime();
  const tStart = dayStart.getTime();
  return tStart >= sStart && tStart <= eStart;
}

async function loadAll(db) {
  // collectionGroup queries pull every nested doc in one round-trip each.
  const [clientsSnap, projectsSnap, tasksSnap] = await Promise.all([
    db.collection('clients').get(),
    db.collectionGroup('projects').get(),
    db.collectionGroup('tasks').get(),
  ]);

  const clients = new Map();
  clientsSnap.forEach(d => clients.set(d.id, { id: d.id, ...d.data() }));

  const projects = new Map();
  projectsSnap.forEach(d => {
    // Path: clients/{cId}/projects/{pId}
    const cId = d.ref.parent.parent.id;
    projects.set(d.id, { id: d.id, _clientId: cId, ...d.data() });
  });

  const tasks = [];
  tasksSnap.forEach(d => {
    // Path: clients/{cId}/projects/{pId}/tasks/{tId}
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

async function loadTodayFocus(db, dayKey) {
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

function buildReport({ clients, projects, tasks, focusSessions, now }) {
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = startOfLocalDay(addDays(now, 1));
  const todayEnd = addDays(todayStart, 1);

  const doneToday = tasks.filter(t => {
    if (t.status !== 'done') return false;
    const cAt = toDate(t.completedAt);
    if (!cAt) return false;
    return cAt >= todayStart && cAt < todayEnd;
  });

  const tomorrowTasks = tasks.filter(t =>
    t.status !== 'done' && taskCoversDay(t, tomorrowStart, addDays(tomorrowStart, 1))
  );

  const overdue = tasks.filter(t => {
    if (t.status === 'done') return false;
    const ed = toDate(t.endDate) || toDate(t.startDate);
    if (!ed) return false;
    return startOfLocalDay(ed).getTime() < todayStart.getTime();
  });

  const focusByProject = new Map();
  let totalMinutes = 0;
  for (const s of focusSessions) {
    totalMinutes += s.minutes || 0;
    focusByProject.set(s.projectId, (focusByProject.get(s.projectId) || 0) + (s.minutes || 0));
  }

  return {
    todayStart, tomorrowStart,
    doneToday, tomorrowTasks, overdue,
    totalMinutes,
    focusByProject,
  };
}

function fmtHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}س ${m}د`;
  if (h) return `${h}س`;
  return `${m}د`;
}

function formatTelegram(r, { clients, projects, now }) {
  const lines = [];
  lines.push(`📊 *تقرير نهاية اليوم*`);
  lines.push(`_${fmtDate(now)}_`);
  lines.push('');

  // Done today
  lines.push(`✅ *إنجازات اليوم* — ${r.doneToday.length}`);
  if (r.doneToday.length === 0) {
    lines.push('_لا توجد مهام مُغلقة اليوم_');
  } else {
    for (const t of r.doneToday.slice(0, 15)) {
      lines.push(`• ${escapeMd(t.title || '—')}  _(${escapeMd(projectLabel(projects, clients, t._projectId))})_`);
    }
    if (r.doneToday.length > 15) lines.push(`_…و ${r.doneToday.length - 15} مهمة أخرى_`);
  }
  lines.push('');

  // Focus
  lines.push(`⏱ *تركيز اليوم* — ${fmtHours(r.totalMinutes)}`);
  if (r.focusByProject.size === 0) {
    lines.push('_لم يتم تسجيل أي جلسة بومودورو اليوم_');
  } else {
    const sorted = [...r.focusByProject.entries()].sort((a, b) => b[1] - a[1]);
    for (const [pid, mins] of sorted) {
      lines.push(`• ${escapeMd(projectLabel(projects, clients, pid))} — ${fmtHours(mins)}`);
    }
  }
  lines.push('');

  // Tomorrow
  lines.push(`📅 *مهام بكرة* — ${r.tomorrowTasks.length}`);
  if (r.tomorrowTasks.length === 0) {
    lines.push('_لا توجد مهام مجدولة لبكرة_');
  } else {
    for (const t of r.tomorrowTasks.slice(0, 20)) {
      const status = t.status === 'doing' ? '🟡' : '🔵';
      lines.push(`${status} ${escapeMd(t.title || '—')}  _(${escapeMd(projectLabel(projects, clients, t._projectId))})_`);
    }
    if (r.tomorrowTasks.length > 20) lines.push(`_…و ${r.tomorrowTasks.length - 20} مهمة أخرى_`);
  }
  lines.push('');

  // Overdue
  if (r.overdue.length > 0) {
    lines.push(`⚠️ *متأخرة* — ${r.overdue.length}`);
    for (const t of r.overdue.slice(0, 10)) {
      const ed = toDate(t.endDate) || toDate(t.startDate);
      const since = ed ? `_(${fmtDate(ed)})_` : '';
      lines.push(`• ${escapeMd(t.title || '—')}  ${since}`);
    }
    if (r.overdue.length > 10) lines.push(`_…و ${r.overdue.length - 10} مهمة متأخرة_`);
  }

  return lines.join('\n');
}

function escapeMd(s) {
  // Telegram "Markdown" (legacy) escapes underscores, asterisks, backticks,
  // brackets — keep this conservative.
  return String(s ?? '').replace(/([_*`\[\]])/g, '\\$1');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatEmailHtml(r, { clients, projects, now }) {
  const card = (title, body) => `
    <div style="background:#2B2D31;border:1px solid #3F424A;border-radius:6px;padding:16px;margin-bottom:14px;">
      <div style="color:#9399A5;font-size:12px;letter-spacing:.5px;margin-bottom:8px;text-transform:uppercase;">${title}</div>
      ${body}
    </div>`;

  const taskRow = (t, extra = '') => `
    <div style="padding:6px 0;border-bottom:1px solid #1E1F22;color:#DFE1E5;font-size:14px;">
      ${escapeHtml(t.title || '—')}
      <span style="color:#9399A5;font-size:12px;"> — ${escapeHtml(projectLabel(projects, clients, t._projectId))}</span>
      ${extra}
    </div>`;

  const doneBody = r.doneToday.length
    ? r.doneToday.map(t => taskRow(t)).join('')
    : '<div style="color:#9399A5;font-size:13px;">لا توجد مهام مُغلقة اليوم</div>';

  const focusBody = (() => {
    if (r.focusByProject.size === 0) {
      return '<div style="color:#9399A5;font-size:13px;">لم يتم تسجيل أي جلسة بومودورو اليوم</div>';
    }
    const sorted = [...r.focusByProject.entries()].sort((a, b) => b[1] - a[1]);
    return `<div style="color:#3DB981;font-size:18px;font-weight:600;margin-bottom:8px;">إجمالي ${escapeHtml(fmtHours(r.totalMinutes))}</div>` +
      sorted.map(([pid, mins]) =>
        `<div style="padding:6px 0;border-bottom:1px solid #1E1F22;color:#DFE1E5;font-size:14px;display:flex;justify-content:space-between;">
          <span>${escapeHtml(projectLabel(projects, clients, pid))}</span>
          <span style="color:#F0A835;">${escapeHtml(fmtHours(mins))}</span>
        </div>`
      ).join('');
  })();

  const tomorrowBody = r.tomorrowTasks.length
    ? r.tomorrowTasks.map(t => {
        const dot = t.status === 'doing'
          ? '<span style="color:#F0A835;">●</span>'
          : '<span style="color:#3574F0;">●</span>';
        return taskRow(t, ` <span style="margin-right:6px;">${dot}</span>`);
      }).join('')
    : '<div style="color:#9399A5;font-size:13px;">لا توجد مهام مجدولة لبكرة</div>';

  const overdueBody = r.overdue.length
    ? r.overdue.map(t => {
        const ed = toDate(t.endDate) || toDate(t.startDate);
        const tag = ed ? ` <span style="color:#E05C5C;font-size:12px;">(${escapeHtml(fmtDate(ed))})</span>` : '';
        return taskRow(t, tag);
      }).join('')
    : '';

  const overdueCard = r.overdue.length
    ? card(`⚠️ متأخرة (${r.overdue.length})`, overdueBody)
    : '';

  return `<!doctype html>
<html dir="rtl" lang="ar"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#1E1F22;font-family:-apple-system,Segoe UI,Tahoma,sans-serif;">
  <div style="max-width:640px;margin:0 auto;">
    <div style="color:#DFE1E5;font-size:22px;font-weight:700;margin-bottom:4px;">📊 تقرير نهاية اليوم</div>
    <div style="color:#9399A5;font-size:13px;margin-bottom:20px;">${escapeHtml(fmtDate(now))}</div>
    ${card(`✅ إنجازات اليوم (${r.doneToday.length})`, doneBody)}
    ${card(`⏱ تركيز اليوم`, focusBody)}
    ${card(`📅 مهام بكرة (${r.tomorrowTasks.length})`, tomorrowBody)}
    ${overdueCard}
    <div style="color:#9399A5;font-size:11px;text-align:center;margin-top:16px;">
      IslamLifeV2 — تقرير تلقائي
    </div>
  </div>
</body></html>`;
}

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

async function sendEmail(html) {
  const user = requireEnv('GMAIL_USER');
  const pass = requireEnv('GMAIL_APP_PASSWORD');
  const to = process.env.GMAIL_TO || user;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const subject = `📊 تقرير نهاية اليوم — ${fmtDate(new Date())}`;
  await transporter.sendMail({ from: user, to, subject, html });
}

async function main() {
  const db = initFirebase();
  const now = new Date();
  const dayKey = ymdKey(now);

  const [{ clients, projects, tasks }, focusSessions] = await Promise.all([
    loadAll(db),
    loadTodayFocus(db, dayKey),
  ]);

  const r = buildReport({ clients, projects, tasks, focusSessions, now });
  const telegramText = formatTelegram(r, { clients, projects, now });
  const emailHtml = formatEmailHtml(r, { clients, projects, now });

  // Send both — capture errors so one channel failing doesn't block the other.
  const results = await Promise.allSettled([
    sendTelegram(telegramText),
    sendEmail(emailHtml),
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
