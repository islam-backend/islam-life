// ================================================================
//  Solo-OS v2.0 — app.js
//  Hierarchy: Clients → Projects → Tasks (Kanban)
//  Firebase Firestore subcollections + Drag & Drop
// ================================================================

import { firebaseConfig } from './firebase-config.js';
import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  getDocs,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Init ───────────────────────────────────────────────────────
const firebaseApp = initializeApp(firebaseConfig);
const db          = getFirestore(firebaseApp);

// ── Firebase Refs ──────────────────────────────────────────────
const clientsRef  = ()                         => collection(db, 'clients');
const projectsRef = (cId)                      => collection(db, 'clients', cId, 'projects');
const tasksRef    = (cId, pId)                 => collection(db, 'clients', cId, 'projects', pId, 'tasks');
const clientDoc   = (cId)                      => doc(db, 'clients', cId);
const projectDoc  = (cId, pId)                 => doc(db, 'clients', cId, 'projects', pId);
const taskDoc     = (cId, pId, tId)            => doc(db, 'clients', cId, 'projects', pId, 'tasks', tId);

// ── App State ──────────────────────────────────────────────────
const state = {
  view:        'clients',  // 'clients' | 'projects' | 'tasks'
  client:      null,
  project:     null,
  clients:     [],
  projects:    [],
  tasks:       [],
  draggedId:   null,
  search:      '',
  deleteTarget: null,
  unsubscribe: null,
};

// ── Avatar Colors ──────────────────────────────────────────────
const COLORS = [
  '#3574F0','#E05C5C','#3DB981','#F0A835','#9B59B6',
  '#E67E22','#1ABC9C','#E91E63','#00BCD4','#FF5722',
  '#607D8B','#8BC34A',
];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

// ── Helpers ────────────────────────────────────────────────────
function getInitials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatDate(ts) {
  if (!ts) return '';
  const d   = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000)    return 'الآن';
  if (diff < 3600000)  return `منذ ${Math.floor(diff/60000)} دقيقة`;
  if (diff < 86400000) return `منذ ${Math.floor(diff/3600000)} ساعة`;
  if (diff < 604800000)return `منذ ${Math.floor(diff/86400000)} يوم`;
  return d.toLocaleDateString('ar-EG', { day:'numeric', month:'short', year:'numeric' });
}

function priorityLabel(p) {
  return { high:'عالي', medium:'متوسط', low:'منخفض' }[p] || p;
}

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, type = 'info', icon = null) {
  const icons  = { success:'✅', error:'❌', info:'💡' };
  const el     = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icon || icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove());
  }, 3200);
}

// ── Loading ────────────────────────────────────────────────────
let loadingHidden = false;
function hideLoading() {
  if (loadingHidden) return;
  loadingHidden = true;
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 420);
}

// ── DB Status ──────────────────────────────────────────────────
function setOnline()  {
  const d = document.getElementById('db-dot');
  const t = document.getElementById('db-status-text');
  if (d) d.className = 'db-dot online';
  if (t) t.textContent = 'متصل';
}
function setOffline() {
  const d = document.getElementById('db-dot');
  const t = document.getElementById('db-status-text');
  if (d) d.className = 'db-dot offline';
  if (t) t.textContent = 'غير متصل';
}

// ════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════

function navigateTo(view, payload = {}) {
  // Cleanup old listener
  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }

  state.view   = view;
  state.search = '';

  // Clear all search inputs
  ['search-clients','search-projects','search-tasks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Hide all views, show target
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  if (view === 'clients') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-clients').classList.add('active');
    subscribeClients();

  } else if (view === 'projects') {
    state.client  = payload.client;
    state.project = null;
    document.getElementById('view-projects').classList.add('active');
    subscribeProjects();

  } else if (view === 'tasks') {
    state.project = payload.project;
    document.getElementById('view-tasks').classList.add('active');
    subscribeTasks();
  }

  updateHeader();
  updateBreadcrumb();
}

// ════════════════════════════════════════════════════════════════
//  FIRESTORE SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════

function subscribeClients() {
  const q = query(clientsRef(), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(q, snap => {
    setOnline(); hideLoading();
    state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('total-badge').textContent = state.clients.length;
    renderClients();
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });
}

function subscribeProjects() {
  const q = query(projectsRef(state.client.id), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(q, snap => {
    setOnline(); hideLoading();
    state.projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProjects();
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });
}

function subscribeTasks() {
  const q = query(tasksRef(state.client.id, state.project.id), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(q, snap => {
    setOnline(); hideLoading();
    state.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderKanban();
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });
}

// ════════════════════════════════════════════════════════════════
//  RENDER — CLIENTS
// ════════════════════════════════════════════════════════════════

function renderClients() {
  const q        = state.search.toLowerCase();
  const filtered = q ? state.clients.filter(c => c.name?.toLowerCase().includes(q)) : state.clients;
  const grid     = document.getElementById('clients-grid');

  if (filtered.length === 0) {
    grid.innerHTML = emptyStateHTML(
      '👥',
      state.search ? 'لا نتائج مطابقة' : 'لا يوجد عملاء بعد',
      state.search ? 'جرّب كلمة بحث مختلفة' : 'اضغط "إضافة عميل" لإضافة أول عميل لك'
    );
    return;
  }

  grid.innerHTML = filtered.map(client => `
    <div class="entity-card" data-id="${client.id}" role="button" tabindex="0">
      <div class="card-header-row">
        <div class="card-avatar" style="background:${escapeHtml(client.color || '#3574F0')}">
          ${escapeHtml(getInitials(client.name))}
        </div>
        <div class="card-top-actions">
          <button class="card-del-btn" data-id="${client.id}" title="حذف العميل">🗑️</button>
        </div>
      </div>
      <div class="card-name">${escapeHtml(client.name)}</div>
      ${client.description ? `<div class="card-desc">${escapeHtml(client.description)}</div>` : ''}
      <div class="card-meta">
        <span>📅 ${formatDate(client.createdAt)}</span>
        <span class="card-arrow">المشاريع ←</span>
      </div>
    </div>
  `).join('') + addCardHTML('إضافة عميل جديد', 'client');

  // Events
  grid.querySelectorAll('.entity-card[data-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-del-btn')) return;
      const client = state.clients.find(c => c.id === card.dataset.id);
      if (client) navigateTo('projects', { client });
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') card.click(); });
  });

  grid.querySelectorAll('.card-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const client = state.clients.find(c => c.id === btn.dataset.id);
      openConfirm({
        type:    'client',
        id:      btn.dataset.id,
        name:    client?.name,
        warning: 'سيتم حذف جميع مشاريع ومهام هذا العميل أيضاً',
      });
    });
  });

  grid.querySelector('.add-card')?.addEventListener('click', () => openModal('client'));
}

// ════════════════════════════════════════════════════════════════
//  RENDER — PROJECTS
// ════════════════════════════════════════════════════════════════

const PROJECT_STATUS = {
  active:    { label: '🟢 نشط',           cls: 'status-active'    },
  paused:    { label: '🟡 متوقف مؤقتاً',  cls: 'status-paused'    },
  completed: { label: '⚫ مكتمل',          cls: 'status-completed' },
};

function renderProjects() {
  const q        = state.search.toLowerCase();
  const filtered = q ? state.projects.filter(p => p.name?.toLowerCase().includes(q)) : state.projects;
  const grid     = document.getElementById('projects-grid');

  if (filtered.length === 0) {
    grid.innerHTML = emptyStateHTML(
      '📁',
      state.search ? 'لا نتائج مطابقة' : 'لا توجد مشاريع بعد',
      state.search ? 'جرّب كلمة بحث مختلفة' : 'اضغط "إضافة مشروع" لإنشاء أول مشروع'
    );
    return;
  }

  grid.innerHTML = filtered.map(project => {
    const st = PROJECT_STATUS[project.status] || PROJECT_STATUS.active;
    return `
      <div class="entity-card" data-id="${project.id}" role="button" tabindex="0">
        <div class="card-header-row">
          <div class="project-icon">📁</div>
          <div class="card-top-actions">
            <span class="status-badge ${st.cls}">${st.label}</span>
            <button class="card-del-btn" data-id="${project.id}" title="حذف المشروع">🗑️</button>
          </div>
        </div>
        <div class="card-name">${escapeHtml(project.name)}</div>
        ${project.description ? `<div class="card-desc">${escapeHtml(project.description)}</div>` : ''}
        <div class="card-meta">
          <span>📅 ${formatDate(project.createdAt)}</span>
          <span class="card-arrow">المهام ←</span>
        </div>
      </div>
    `;
  }).join('') + addCardHTML('إضافة مشروع جديد', 'project');

  // Events
  grid.querySelectorAll('.entity-card[data-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-del-btn')) return;
      const project = state.projects.find(p => p.id === card.dataset.id);
      if (project) navigateTo('tasks', { project });
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') card.click(); });
  });

  grid.querySelectorAll('.card-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const project = state.projects.find(p => p.id === btn.dataset.id);
      openConfirm({
        type:    'project',
        id:      btn.dataset.id,
        name:    project?.name,
        warning: 'سيتم حذف جميع مهام هذا المشروع أيضاً',
      });
    });
  });

  grid.querySelector('.add-card')?.addEventListener('click', () => openModal('project'));
}

// ════════════════════════════════════════════════════════════════
//  RENDER — KANBAN (Tasks)
// ════════════════════════════════════════════════════════════════

function renderKanban() {
  const q        = state.search.toLowerCase();
  const filtered = q
    ? state.tasks.filter(t => t.title?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))
    : state.tasks;

  const groups = { todo: [], doing: [], done: [] };
  filtered.forEach(t => { if (groups[t.status]) groups[t.status].push(t); });

  // Counters
  document.getElementById('count-todo').textContent  = groups.todo.length;
  document.getElementById('count-doing').textContent = groups.doing.length;
  document.getElementById('count-done').textContent  = groups.done.length;
  // Stats in header
  const st = document.getElementById('stat-todo');
  const sd = document.getElementById('stat-doing');
  const sn = document.getElementById('stat-done');
  if (st) st.textContent  = groups.todo.length;
  if (sd) sd.textContent  = groups.doing.length;
  if (sn) sn.textContent  = groups.done.length;

  [
    { el: document.getElementById('col-todo'),  tasks: groups.todo,  emptyIcon: '📋', emptyText: 'لا توجد مهام\nاضغط + لإضافة مهمة' },
    { el: document.getElementById('col-doing'), tasks: groups.doing, emptyIcon: '⏳', emptyText: 'اسحب مهمة هنا\nلبدء العمل عليها' },
    { el: document.getElementById('col-done'),  tasks: groups.done,  emptyIcon: '✅', emptyText: 'المهام المنجزة\nستظهر هنا' },
  ].forEach(({ el, tasks, emptyIcon, emptyText }) => {
    if (!el) return;
    el.innerHTML = tasks.length === 0
      ? `<div class="col-empty"><div class="empty-icon">${emptyIcon}</div><div style="text-align:center;line-height:1.9;white-space:pre-line">${emptyText}</div></div>`
      : tasks.map(taskCardHTML).join('');
    bindTaskCardEvents(el);
  });
}

function taskCardHTML(task) {
  return `
    <div class="task-card" id="tc-${task.id}" draggable="true" data-id="${task.id}">
      <div class="card-top">
        <div class="card-title">${escapeHtml(task.title)}</div>
        <button class="card-menu-btn" data-id="${task.id}" title="حذف المهمة">✕</button>
      </div>
      ${task.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;line-height:1.55">${escapeHtml(task.notes)}</div>` : ''}
      <div class="card-footer">
        <span class="card-date">🕐 ${formatDate(task.createdAt)}</span>
        ${task.priority ? `<span class="card-priority priority-${task.priority}">${priorityLabel(task.priority)}</span>` : ''}
      </div>
    </div>`;
}

function bindTaskCardEvents(colEl) {
  colEl.querySelectorAll('.card-menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const task = state.tasks.find(t => t.id === btn.dataset.id);
      openConfirm({ type: 'task', id: btn.dataset.id, name: task?.title });
    });
  });

  colEl.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      state.draggedId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      state.draggedId = null;
    });
  });
}

// ── Drag & Drop on Columns ──────────────────────────────────────
function setupColumnDnD() {
  document.querySelectorAll('#kanban .column').forEach(col => {
    const status = col.dataset.status;

    col.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });

    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!state.draggedId || !state.client || !state.project) return;

      const task = state.tasks.find(t => t.id === state.draggedId);
      if (!task || task.status === status) return;

      const labels = { todo: 'المطلوب', doing: 'جاري التنفيذ', done: 'تم الإنتهاء' };
      try {
        await updateDoc(taskDoc(state.client.id, state.project.id, state.draggedId), { status });
        toast(`تم نقل المهمة إلى "${labels[status]}"`, 'success');
      } catch (err) {
        toast('فشل تحديث المهمة', 'error'); console.error(err);
      }
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  HEADER & BREADCRUMB
// ════════════════════════════════════════════════════════════════

function updateHeader() {
  const titleEl   = document.getElementById('page-title');
  const actionsEl = document.getElementById('header-actions');
  const statsEl   = document.getElementById('header-stats');

  if (state.view === 'clients') {
    titleEl.textContent  = '👥 العملاء';
    statsEl.innerHTML    = '';
    actionsEl.innerHTML  = `<button class="btn-primary" id="hdr-add-btn">+ إضافة عميل</button>`;
    document.getElementById('hdr-add-btn').onclick = () => openModal('client');

  } else if (state.view === 'projects') {
    titleEl.textContent  = `📁 ${escapeHtml(state.client?.name || '')}`;
    statsEl.innerHTML    = '';
    actionsEl.innerHTML  = `<button class="btn-primary" id="hdr-add-btn">+ إضافة مشروع</button>`;
    document.getElementById('hdr-add-btn').onclick = () => openModal('project');

  } else if (state.view === 'tasks') {
    titleEl.textContent = `📋 ${escapeHtml(state.project?.name || '')}`;
    statsEl.innerHTML   = `
      <div class="stat-pill"><span class="dot todo"></span><span id="stat-todo">0</span></div>
      <div class="stat-pill"><span class="dot doing"></span><span id="stat-doing">0</span></div>
      <div class="stat-pill"><span class="dot done"></span><span id="stat-done">0</span></div>`;
    actionsEl.innerHTML = `<button class="btn-primary" id="hdr-add-btn">+ إضافة مهمة</button>`;
    document.getElementById('hdr-add-btn').onclick = () => openModal('task');
    // Re-render stats after DOM update
    renderKanban();
  }
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (state.view === 'clients') { bc.innerHTML = ''; return; }

  let html = `<span class="breadcrumb-link" data-to="clients">🏠 الرئيسية</span>`;

  if (state.view === 'projects') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">${escapeHtml(state.client?.name)}</span>`;
  }

  if (state.view === 'tasks') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="projects">${escapeHtml(state.client?.name)}</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">${escapeHtml(state.project?.name)}</span>`;
  }

  bc.innerHTML = html;

  bc.querySelectorAll('[data-to]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.to === 'clients')  navigateTo('clients');
      if (el.dataset.to === 'projects') navigateTo('projects', { client: state.client });
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  MODAL (Dynamic)
// ════════════════════════════════════════════════════════════════

let currentModalType = null;

const MODAL_CONFIGS = {
  client: {
    title:      '👤 إضافة عميل جديد',
    submitText: 'إضافة العميل',
    fields: `
      <div class="form-group">
        <label class="form-label">اسم العميل <span class="required">*</span></label>
        <input type="text" id="f-name" class="form-input"
          placeholder="مثال: شركة النور للتكنولوجيا" maxlength="80" required />
      </div>
      <div class="form-group">
        <label class="form-label">وصف مختصر (اختياري)</label>
        <input type="text" id="f-desc" class="form-input"
          placeholder="مثال: عميل تصميم مواقع" maxlength="120" />
      </div>`,
  },
  project: {
    title:      '📁 إضافة مشروع جديد',
    submitText: 'إضافة المشروع',
    fields: `
      <div class="form-group">
        <label class="form-label">اسم المشروع <span class="required">*</span></label>
        <input type="text" id="f-name" class="form-input"
          placeholder="مثال: موقع شركة النور" maxlength="80" required />
      </div>
      <div class="form-group">
        <label class="form-label">وصف مختصر (اختياري)</label>
        <input type="text" id="f-desc" class="form-input"
          placeholder="مثال: موقع ووردبريس 5 صفحات" maxlength="150" />
      </div>
      <div class="form-group">
        <label class="form-label">الحالة</label>
        <select id="f-status" class="form-select">
          <option value="active">🟢 نشط</option>
          <option value="paused">🟡 متوقف مؤقتاً</option>
          <option value="completed">⚫ مكتمل</option>
        </select>
      </div>`,
  },
  task: {
    title:      '✨ إضافة مهمة جديدة',
    submitText: 'إضافة المهمة',
    fields: `
      <div class="form-group">
        <label class="form-label">عنوان المهمة <span class="required">*</span></label>
        <input type="text" id="f-title" class="form-input"
          placeholder="مثال: تصميم الصفحة الرئيسية" maxlength="120" required />
      </div>
      <div class="form-group">
        <label class="form-label">الأولوية</label>
        <select id="f-priority" class="form-select">
          <option value="">— بدون —</option>
          <option value="high">🔴 عالي</option>
          <option value="medium">🟡 متوسط</option>
          <option value="low">🟢 منخفض</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">ملاحظات (اختياري)</label>
        <textarea id="f-notes" class="form-textarea"
          placeholder="تفاصيل إضافية عن المهمة..." maxlength="300"></textarea>
      </div>`,
  },
};

function openModal(type) {
  currentModalType = type;
  const cfg = MODAL_CONFIGS[type];
  document.getElementById('modal-title').textContent   = cfg.title;
  document.getElementById('modal-body').innerHTML      = cfg.fields;
  document.getElementById('modal-submit-btn').textContent = cfg.submitText;
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.querySelector('#modal-body input, #modal-body textarea')?.focus(), 60);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-form').reset();
  document.getElementById('modal-body').innerHTML = '';
  currentModalType = null;
}

document.getElementById('close-modal-btn').addEventListener('click',  closeModal);
document.getElementById('cancel-modal-btn').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ── Modal Submit ────────────────────────────────────────────────
document.getElementById('modal-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn  = document.getElementById('modal-submit-btn');
  const orig = btn.textContent;
  btn.disabled    = true;
  btn.textContent = 'جاري الإضافة...';

  try {
    if (currentModalType === 'client') {
      const name = document.getElementById('f-name').value.trim();
      const desc = document.getElementById('f-desc')?.value.trim();
      if (!name) { toast('يرجى إدخال اسم العميل', 'error'); return; }
      await addDoc(clientsRef(), { name, description: desc || null, color: randomColor(), createdAt: serverTimestamp() });
      toast('تمت إضافة العميل! 🎉', 'success');
      closeModal();

    } else if (currentModalType === 'project') {
      const name   = document.getElementById('f-name').value.trim();
      const desc   = document.getElementById('f-desc')?.value.trim();
      const status = document.getElementById('f-status')?.value || 'active';
      if (!name) { toast('يرجى إدخال اسم المشروع', 'error'); return; }
      await addDoc(projectsRef(state.client.id), { name, description: desc || null, status, createdAt: serverTimestamp() });
      toast('تمت إضافة المشروع! 🎉', 'success');
      closeModal();

    } else if (currentModalType === 'task') {
      const title    = document.getElementById('f-title').value.trim();
      const priority = document.getElementById('f-priority')?.value || null;
      const notes    = document.getElementById('f-notes')?.value.trim() || null;
      if (!title) { toast('يرجى إدخال عنوان المهمة', 'error'); return; }
      await addDoc(tasksRef(state.client.id, state.project.id), {
        title, priority, notes, status: 'todo', createdAt: serverTimestamp()
      });
      toast('تمت إضافة المهمة! 🎉', 'success');
      closeModal();
    }
  } catch (err) {
    toast('حدث خطأ، تحقق من الاتصال', 'error'); console.error(err);
  } finally {
    btn.disabled    = false;
    btn.textContent = orig;
  }
});

// ════════════════════════════════════════════════════════════════
//  CONFIRM DELETE
// ════════════════════════════════════════════════════════════════

function openConfirm({ type, id, name, warning = '' }) {
  state.deleteTarget = { type, id };
  const titles = { client: 'حذف العميل', project: 'حذف المشروع', task: 'حذف المهمة' };
  document.getElementById('confirm-title').textContent    = titles[type] || 'حذف';
  document.getElementById('confirm-item-name').textContent = name || '';
  document.getElementById('confirm-warning').textContent  = warning;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

document.getElementById('confirm-no').addEventListener('click', () => {
  document.getElementById('confirm-overlay').classList.add('hidden');
  state.deleteTarget = null;
});

document.getElementById('confirm-yes').addEventListener('click', async () => {
  document.getElementById('confirm-overlay').classList.add('hidden');
  const target = state.deleteTarget;
  state.deleteTarget = null;
  if (!target) return;

  try {
    if (target.type === 'client') {
      await deleteClientCascade(target.id);
      toast('تم حذف العميل وبياناته', 'info', '🗑️');

    } else if (target.type === 'project') {
      await deleteProjectCascade(state.client.id, target.id);
      toast('تم حذف المشروع ومهامه', 'info', '🗑️');

    } else if (target.type === 'task') {
      await deleteDoc(taskDoc(state.client.id, state.project.id, target.id));
      toast('تم حذف المهمة', 'info', '🗑️');
    }
  } catch (err) {
    toast('فشل الحذف', 'error'); console.error(err);
  }
});

// ── Cascade Delete ──────────────────────────────────────────────
async function deleteClientCascade(clientId) {
  const batch       = writeBatch(db);
  const projectsSnap = await getDocs(projectsRef(clientId));

  for (const pDoc of projectsSnap.docs) {
    const tasksSnap = await getDocs(tasksRef(clientId, pDoc.id));
    tasksSnap.docs.forEach(tDoc => batch.delete(tDoc.ref));
    batch.delete(pDoc.ref);
  }
  batch.delete(clientDoc(clientId));
  await batch.commit();
}

async function deleteProjectCascade(clientId, projectId) {
  const batch     = writeBatch(db);
  const tasksSnap = await getDocs(tasksRef(clientId, projectId));
  tasksSnap.docs.forEach(tDoc => batch.delete(tDoc.ref));
  batch.delete(projectDoc(clientId, projectId));
  await batch.commit();
}

// ════════════════════════════════════════════════════════════════
//  SEARCH
// ════════════════════════════════════════════════════════════════

function onSearch(e) {
  state.search = e.target.value;
  if (state.view === 'clients')  renderClients();
  if (state.view === 'projects') renderProjects();
  if (state.view === 'tasks')    renderKanban();
}

document.getElementById('search-clients').addEventListener('input',  onSearch);
document.getElementById('search-projects').addEventListener('input', onSearch);
document.getElementById('search-tasks').addEventListener('input',    onSearch);

// ════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    document.getElementById('confirm-overlay').classList.add('hidden');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const type = state.view === 'clients' ? 'client' : state.view === 'projects' ? 'project' : 'task';
    openModal(type);
  }
});

// Sidebar nav
document.getElementById('nav-clients').addEventListener('click', () => navigateTo('clients'));

// ════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════

function emptyStateHTML(icon, title, subtitle = '') {
  return `
    <div class="view-empty">
      <div class="empty-big-icon">${icon}</div>
      <h3>${title}</h3>
      ${subtitle ? `<p>${subtitle}</p>` : ''}
    </div>`;
}

function addCardHTML(label, type) {
  return `<div class="add-card" data-add-type="${type}">
    <span class="add-icon">＋</span>
    <span>${label}</span>
  </div>`;
}

// Refresh timestamps every minute
setInterval(() => {
  if (state.view === 'clients')  renderClients();
  if (state.view === 'projects') renderProjects();
  if (state.view === 'tasks')    renderKanban();
}, 60000);

// ════════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════════

setupColumnDnD();
navigateTo('clients');
