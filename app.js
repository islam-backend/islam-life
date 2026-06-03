// ================================================================
//  islam.walied v3.0 — app.js
//  Hierarchy: Dashboard → Clients → Projects → Tasks (Kanban)
//  Firebase Firestore subcollections + Drag & Drop + Dashboard
// ================================================================

import { firebaseConfig, allowedEmail } from './firebase-config.js';
import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  collection,
  collectionGroup,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  getDocs,
  setDoc,
  writeBatch,
  increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Init ───────────────────────────────────────────────────────
const firebaseApp = initializeApp(firebaseConfig);
const db          = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache()
});
const auth        = getAuth(firebaseApp);
const provider    = new GoogleAuthProvider();

// ════════════════════════════════════════════════════════════════
//  BOOT & AUTH
// ════════════════════════════════════════════════════════════════

let isBooted = false;

onAuthStateChanged(auth, async (user) => {
  const loginScreen = document.getElementById('login-screen');
  const loadingOverlay = document.getElementById('loading-overlay');
  
  if (user) {
    // Check if the authenticated user matches the allowed email
    if (user.email === allowedEmail) {
      if (loginScreen) loginScreen.classList.add('hidden');
      if (loadingOverlay) loadingOverlay.classList.add('hidden');

      if (!isBooted) {
        setupColumnDnD();
        navigateTo('dashboard');
        isBooted = true;
      }
    } else {
      // Sign out and display error
      await signOut(auth);
      showLoginError('❌ عذراً، هذا الحساب غير مصرح له بالدخول. يرجى تسجيل الدخول بحساب المدير.');
    }
  } else {
    isBooted = false;
    // Clear all Firestore listeners on signout
    cleanupListeners();
    // Reset local data
    state.clients = [];
    state.projects = [];
    state.tasks = [];
    state.allProjects = [];
    state.allTasks = [];
    state.client = null;
    state.project = null;
    // Stop focus timer if running
    if (state.focusInterval) {
      clearInterval(state.focusInterval);
      state.focusInterval = null;
      state.focusRunning = false;
    }

    // Hide main screen, show login screen
    if (loginScreen) loginScreen.classList.remove('hidden');
    hideLoading(); // Remove DB spinner if still there
  }
});

function showLoginError(msg) {
  const errBox = document.getElementById('login-error');
  if (errBox) {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  }
}

// Bind Sign-In with Google button
const googleLoginBtn = document.getElementById('google-login-btn');
if (googleLoginBtn) {
  googleLoginBtn.addEventListener('click', async () => {
    googleLoginBtn.disabled = true;
    const origText = googleLoginBtn.innerHTML;
    googleLoginBtn.innerHTML = `<span>🔄 جاري الاتصال بجوجل...</span>`;
    
    const errBox = document.getElementById('login-error');
    if (errBox) errBox.classList.add('hidden');
    
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      showLoginError(`❌ فشل تسجيل الدخول: ${err.message || 'يرجى المحاولة مجدداً'}`);
      googleLoginBtn.disabled = false;
      googleLoginBtn.innerHTML = origText;
    }
  });
}

// Bind Sign-Out button
const signoutBtn = document.getElementById('signout-btn');
if (signoutBtn) {
  signoutBtn.addEventListener('click', async () => {
    try {
      await signOut(auth);
      toast('تم تسجيل الخروج بنجاح', 'info', '👋');
    } catch (err) {
      console.error(err);
      toast('فشل تسجيل الخروج', 'error');
    }
  });
}

// ════════════════════════════════════════════════════════════════
//  COLLAPSIBLE SIDEBAR LOGIC
// ════════════════════════════════════════════════════════════════

const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('sidebar-toggle-btn');

if (sidebar && toggleBtn) {
  // Read saved preference from localStorage
  const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  if (isCollapsed) {
    sidebar.classList.add('collapsed');
  }

  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', collapsed);
  });
}

// ── Sidebar Nav Item Click Handlers ──────────────────────────
const navDashboard = document.getElementById('nav-dashboard');
const navClients   = document.getElementById('nav-clients');
const navFocus     = document.getElementById('nav-focus');
const navFinance   = document.getElementById('nav-finance');

if (navDashboard) {
  navDashboard.addEventListener('click', () => navigateTo('dashboard'));
}
if (navClients) {
  navClients.addEventListener('click', () => navigateTo('clients'));
}
if (navFocus) {
  navFocus.addEventListener('click', () => navigateTo('focus'));
}
if (navFinance) {
  navFinance.addEventListener('click', () => navigateTo('finance'));
}

// ── Collapsible Dashboard Projects Section Toggle ──
document.addEventListener('click', e => {
  const toggle = e.target.closest('#dash-projects-toggle');
  if (toggle) {
    const sec = document.getElementById('dash-projects-sec');
    if (sec) {
      const collapsed = sec.classList.toggle('collapsed');
      localStorage.setItem('dashboard-projects-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', !collapsed);
    }
  }
});

// ════════════════════════════════════════════════════════════════
//  ADDITIONAL UX EVENT BINDINGS (Column Add)
// ════════════════════════════════════════════════════════════════

// 2. Toolbar Add Buttons
const btnAddClient = document.getElementById('btn-add-client');
if (btnAddClient) {
  btnAddClient.addEventListener('click', () => openModal('client'));
}
const btnAddProject = document.getElementById('btn-add-project');
if (btnAddProject) {
  btnAddProject.addEventListener('click', () => openModal('project'));
}
const btnAddTask = document.getElementById('btn-add-task');
if (btnAddTask) {
  btnAddTask.addEventListener('click', () => openModal('task'));
}

// Toolbar Back Buttons
const btnBackProjects = document.getElementById('btn-back-projects');
if (btnBackProjects) {
  btnBackProjects.addEventListener('click', () => {
    navigateTo('clients');
  });
}
const btnBackTasks = document.getElementById('btn-back-tasks');
if (btnBackTasks) {
  btnBackTasks.addEventListener('click', () => {
    if (state.navigationSource === 'dashboard') {
      navigateTo('dashboard');
    } else if (state.navigationSource === 'projects-all') {
      navigateTo('projects');
    } else {
      navigateTo('projects', { client: state.client });
    }
  });
}

// 3. Expandable Search Boxes Logic
const searchBoxes = [
  { boxId: 'search-box-clients', inputId: 'search-clients' },
  { boxId: 'search-box-projects', inputId: 'search-projects' },
  { boxId: 'search-box-tasks', inputId: 'search-tasks' }
];

searchBoxes.forEach(({ boxId, inputId }) => {
  const box = document.getElementById(boxId);
  const input = document.getElementById(inputId);
  if (!box || !input) return;

  const btn = box.querySelector('.search-icon-btn');
  
  // Click icon to focus input and expand
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      box.classList.add('expanded');
      input.focus();
    });
  }

  // Input events
  input.addEventListener('focus', () => box.classList.add('expanded'));
  input.addEventListener('input', () => {
    if (input.value) {
      box.classList.add('expanded');
    }
  });
  input.addEventListener('blur', () => {
    if (!input.value) {
      box.classList.remove('expanded');
    }
  });
});

// ════════════════════════════════════════════════════════════════
//  QUICK ADD TASK — Inline form in Todo column
// ════════════════════════════════════════════════════════════════

const colAddTaskBtn  = document.getElementById('col-add-task-btn');
const quickAddForm   = document.getElementById('quick-add-todo');
const quickAddInput  = document.getElementById('quick-add-input');
const quickAddSubmit = document.getElementById('quick-add-submit');
const quickAddCancel = document.getElementById('quick-add-cancel');

function showQuickAdd() {
  if (!quickAddForm || !quickAddInput) return;
  quickAddForm.classList.remove('hidden');
  quickAddInput.value = '';
  quickAddInput.focus();
  if (colAddTaskBtn) colAddTaskBtn.classList.add('active');
}

function hideQuickAdd() {
  if (!quickAddForm) return;
  quickAddForm.classList.add('hidden');
  if (colAddTaskBtn) colAddTaskBtn.classList.remove('active');
}

if (colAddTaskBtn) {
  colAddTaskBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Only show quick-add when on tasks view
    if (state.view === 'tasks') {
      showQuickAdd();
    } else {
      openModal('task');
    }
  });
}

if (quickAddCancel) {
  quickAddCancel.addEventListener('click', () => hideQuickAdd());
}

if (quickAddInput) {
  // Submit on Enter (without Shift)
  quickAddInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await submitQuickAdd();
    }
    if (e.key === 'Escape') hideQuickAdd();
  });
}

if (quickAddSubmit) {
  quickAddSubmit.addEventListener('click', async () => await submitQuickAdd());
}

async function submitQuickAdd() {
  if (!quickAddInput) return;
  const title = quickAddInput.value.trim();
  if (!title) {
    quickAddInput.classList.add('shake');
    setTimeout(() => quickAddInput.classList.remove('shake'), 400);
    return;
  }
  if (!state.client || !state.project) {
    toast('يجب فتح مشروع أولاً', 'error');
    return;
  }
  quickAddSubmit.disabled = true;
  quickAddSubmit.textContent = '...';
  try {
    await addDoc(tasksRef(state.client.id, state.project.id), {
      title,
      priority: null,
      notes: null,
      status: 'todo',
      createdAt: serverTimestamp(),
    });
    toast(`تمت إضافة "‎${title}‏" 🎉`, 'success');
    quickAddInput.value = '';
    quickAddInput.focus();
  } catch (err) {
    toast('حدث خطأ، تحقق من الاتصال', 'error');
    console.error(err);
  } finally {
    quickAddSubmit.disabled = false;
    quickAddSubmit.textContent = 'إضافة';
  }
}


// ── Firebase Refs ──────────────────────────────────────────────
const clientsRef  = ()                         => collection(db, 'clients');
const projectsRef = (cId)                      => collection(db, 'clients', cId, 'projects');
const tasksRef    = (cId, pId)                 => collection(db, 'clients', cId, 'projects', pId, 'tasks');
const clientDoc   = (cId)                      => doc(db, 'clients', cId);
const projectDoc  = (cId, pId)                 => doc(db, 'clients', cId, 'projects', pId);
const taskDoc     = (cId, pId, tId)            => doc(db, 'clients', cId, 'projects', pId, 'tasks', tId);
const userStatsDoc = ()                        => doc(db, 'meta', 'userStats');
// v22.0 — Finance hub collections
const incomeSourcesRef = ()                    => collection(db, 'incomeSources');
const incomeSourceDoc  = (id)                  => doc(db, 'incomeSources', id);
// v25.0 — Dynamic budget buckets + transactions (replaces hardcoded categories)
const bucketsRef       = ()                    => collection(db, 'budget_buckets');
const bucketDoc        = (id)                  => doc(db, 'budget_buckets', id);
const transactionsRef  = ()                    => collection(db, 'transactions');
const transactionDoc   = (id)                  => doc(db, 'transactions', id);

// ── App State ──────────────────────────────────────────────────
const state = {
  view:        'dashboard',  // 'dashboard' | 'clients' | 'projects' | 'tasks'
  client:      null,
  project:     null,
  clients:     [],
  projects:    [],
  tasks:       [],
  allProjects: [],   // Dashboard: all projects across all clients
  allTasks:    [],   // Dashboard: all tasks across all projects
  navigationSource: 'dashboard', // 'dashboard' | 'clients' | 'projects-all'
  dashUnsubProjects: null,
  dashUnsubTasks:    null,
  dashUnsubStats:    null,
  projUnsub:         null,
  taskUnsub:         null,
  draggedId:   null,
  draggedEntityId:   null,
  draggedEntityType: null,
  dayDraggedId:        null,
  dayDraggedClientId:  null,
  dayDraggedProjectId: null,
  dayDragKind:         null,    // 'task' | 'block'
  dayDraggedBlockClient:  null,
  dayDraggedBlockProject: null,
  search:      '',
  deleteTarget: null,
  editTarget:   null,
  unsubscribe: null,
  // Focus Timer State (v7.0)
  focusInterval:        null,
  focusRunning:         false,
  focusTimeLeft:        25 * 60,
  focusState:           'work',   // 'work' | 'break'
  focusWorkMinutes:     25,
  focusBreakMinutes:    5,
  focusProjectId:       null,
  focusTaskId:          null,
  // Calendar state (v9.2)
  calendarCursor:       null,     // Date pointing at the displayed month
  dayDate:              null,     // Date selected for day-details view
  totalRestHours:       Number(localStorage.getItem('totalRestHours')) || 0,
  // Finance Hub (v22.0 → v25.0 dynamic buckets)
  incomeSources:        [],
  buckets:              [],       // budget_buckets — dynamic categories
  transactions:         [],       // replaces flat `expenses`
  financeUnsubIncome:   null,
  financeUnsubBuckets:  null,
  financeUnsubTx:       null,
  financeCursor:        null,     // Date pointing at the displayed finance month
  financeShowArchived:  false,    // toggle to reveal archived buckets
};

// ── Cleanup Listeners ──────────────────────────────────────────
// v17.0 — Single chokepoint that tears down EVERY Firestore onSnapshot
// AND cancels any debounced render queued by the previous view. Called
// at the top of every navigateTo() so listeners can't accumulate or
// fire into a stale view.
function cleanupListeners() {
  const safeUnsub = (fn) => {
    try { if (typeof fn === 'function') fn(); } catch (e) { console.error('Unsub failed:', e); }
  };
  safeUnsub(state.unsubscribe);          state.unsubscribe = null;
  safeUnsub(state.dashUnsubProjects);    state.dashUnsubProjects = null;
  safeUnsub(state.dashUnsubTasks);       state.dashUnsubTasks = null;
  safeUnsub(state.dashUnsubStats);       state.dashUnsubStats = null;
  safeUnsub(state.projUnsub);            state.projUnsub = null;
  safeUnsub(state.taskUnsub);            state.taskUnsub = null;
  safeUnsub(state.financeUnsubIncome);   state.financeUnsubIncome = null;
  safeUnsub(state.financeUnsubBuckets);  state.financeUnsubBuckets = null;
  safeUnsub(state.financeUnsubTx);       state.financeUnsubTx = null;
  cancelPendingRenders();
}

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
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
    .replace(/`/g,'&#96;');
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
  return { high:'عالي', medium:'متوسط', low:'منخفض' }[p] || '';
}

function formatMinutes(m) {
  m = Number(m) || 0;
  if (m <= 0) return '0 د';
  if (m < 60) return `${m} د`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} س ${rem} د` : `${h} س`;
}

// ── Local-date helpers (v16.0 — fixes timezone "day-1" bug) ──
// Returns "YYYY-MM-DD" using the user's LOCAL date — never UTC, so a
// task whose local date is the 4th never reads back as the 3rd.
function toLocalISODate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

// Parse "YYYY-MM-DD" from a <input type=date> as LOCAL midnight (not UTC).
function fromLocalISODate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// ── Debounce helper (v16.0 — kills onSnapshot quick-reload flicker) ──
// Each render function gets its own trailing-edge debouncer keyed by
// the function reference itself, so calls coalesce without losing the last one.
// v17.0 — moved to Map so cleanupListeners() can cancel pending renders
// that would otherwise fire AFTER the view (and its listeners) was torn down.
const _debounceTimers = new Map();
function debounceRender(fn, wait = 90) {
  const existing = _debounceTimers.get(fn);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    _debounceTimers.delete(fn);
    fn();
  }, wait);
  _debounceTimers.set(fn, t);
}
function cancelPendingRenders() {
  for (const t of _debounceTimers.values()) clearTimeout(t);
  _debounceTimers.clear();
}

// Format hours as a compact human label (e.g. 1.5 → "1 س 30 د", 0.83 → "50 د")
function formatHours(h) {
  const total = Number(h) || 0;
  if (total <= 0) return '0 س';
  const totalMin = Math.round(total * 60);
  if (totalMin < 60) return `${totalMin} د`;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return mm ? `${hh} س ${mm} د` : `${hh} س`;
}

// v22.0 — Mono "Xh Ym" format for the dark-theme card tag (e.g. 1.5 → "1h 30m").
function formatHoursHm(h) {
  const total = Number(h) || 0;
  if (total <= 0) return '0h';
  const totalMin = Math.round(total * 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, type = 'info', icon = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons  = { success:'✅', error:'❌', info:'💡' };
  const el     = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icon || icons[type]}</span><span>${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove());
  }, 3200);
}

// ── Image Lightbox (v16.0) ─────────────────────────────────────
function openImageLightbox(src) {
  if (!src) return;
  let box = document.getElementById('img-lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'img-lightbox';
    box.className = 'img-lightbox';
    box.innerHTML = `<img alt="" /><button class="img-lightbox-close" aria-label="إغلاق">✕</button>`;
    document.body.appendChild(box);
    const close = () => box.classList.remove('open');
    box.addEventListener('click', e => {
      if (e.target === box || e.target.classList.contains('img-lightbox-close')) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && box.classList.contains('open')) close();
    });
  }
  box.querySelector('img').src = src;
  box.classList.add('open');
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
  // Cleanup old listeners
  cleanupListeners();

  // Hide quick-add form when navigating
  hideQuickAdd();

  state.view   = view;
  state.search = '';

  // Clear all search inputs and collapse search boxes
  ['search-clients','search-projects','search-tasks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['search-box-clients','search-box-projects','search-box-tasks'].forEach(id => {
    const box = document.getElementById(id);
    if (box) box.classList.remove('expanded');
  });

  // Track navigation source
  if (view === 'dashboard') {
    state.navigationSource = 'dashboard';
  } else if (view === 'clients') {
    state.navigationSource = 'clients';
  } else if (view === 'projects') {
    if (payload.client) {
      state.navigationSource = 'clients';
    } else {
      state.navigationSource = 'projects-all';
    }
  } else if (view === 'tasks') {
    if (payload.fromDashboard) {
      state.navigationSource = 'dashboard';
    } else if (payload.fromProjectsAll) {
      state.navigationSource = 'projects-all';
    } else {
      state.navigationSource = 'clients';
    }
  }

  // Update sidebar nav active states
  const showDashActive    = (view === 'dashboard') || (view === 'tasks' && state.navigationSource === 'dashboard');
  const showClientsActive = (view === 'clients') || (view === 'projects' && state.client) || (view === 'tasks' && state.navigationSource === 'clients');
  const showFocusActive   = (view === 'focus');
  const showFinanceActive = (view === 'finance');

  document.getElementById('nav-dashboard')?.classList.toggle('active', !!showDashActive);
  document.getElementById('nav-clients')?.classList.toggle('active', !!showClientsActive);
  document.getElementById('nav-focus')?.classList.toggle('active', !!showFocusActive);
  document.getElementById('nav-finance')?.classList.toggle('active', !!showFinanceActive);

  // Hide all views, show target
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  if (view === 'dashboard') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-dashboard').classList.add('active');

    // Restore projects section collapse state from localStorage
    const sec = document.getElementById('dash-projects-sec');
    const isCollapsed = localStorage.getItem('dashboard-projects-collapsed') === 'true';
    if (sec) {
      sec.classList.toggle('collapsed', isCollapsed);
    }
    const toggleBtn = document.getElementById('dash-projects-toggle');
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', !isCollapsed);
    }

    subscribeDashboard();

  } else if (view === 'clients') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-clients').classList.add('active');
    subscribeClients();

  } else if (view === 'projects') {
    state.client  = payload.client || null;
    state.project = null;
    document.getElementById('view-projects').classList.add('active');
    subscribeProjects();

  } else if (view === 'focus') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-focus').classList.add('active');
    subscribeFocus();

  } else if (view === 'tasks') {
    if (payload.client)  state.client  = payload.client;
    if (payload.project) state.project = payload.project;
    document.getElementById('view-tasks').classList.add('active');
    subscribeTasks();

  } else if (view === 'calendar') {
    state.client  = null;
    state.project = null;
    if (!state.calendarCursor) state.calendarCursor = new Date();
    document.getElementById('view-calendar').classList.add('active');
    subscribeCalendar();

  } else if (view === 'day') {
    document.getElementById('view-day').classList.add('active');
    if (payload.date instanceof Date) state.dayDate = payload.date;
    subscribeCalendar();   // shares same listeners as calendar
    renderDayView();

  } else if (view === 'finance') {
    state.client  = null;
    state.project = null;
    if (!state.financeCursor) state.financeCursor = new Date();
    document.getElementById('view-finance').classList.add('active');
    subscribeFinance();
  }

  updateHeader();
  updateBreadcrumb();
}

// ════════════════════════════════════════════════════════════════
//  FIRESTORE SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════

// ── Dashboard Global Subscription ─────────────────────────────
function subscribeDashboard() {
  // Unsubscribe any previous dashboard listeners
  if (state.dashUnsubProjects) { state.dashUnsubProjects(); state.dashUnsubProjects = null; }
  if (state.dashUnsubTasks)    { state.dashUnsubTasks();    state.dashUnsubTasks    = null; }

  // 0. Also subscribe to clients so we can look up client names
  const clientQ = query(clientsRef(), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(clientQ, snap => {
    setOnline(); hideLoading();
    state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const badge = document.getElementById('total-badge');
    if (badge) badge.textContent = state.clients.length;
    debounceRender(renderDashboard);
  }, err => { setOffline(); hideLoading(); console.error(err); });

  // 1. Listen to all projects across all clients via collectionGroup
  const projQ = query(collectionGroup(db, 'projects'));
  state.dashUnsubProjects = onSnapshot(projQ, snap => {
    setOnline(); hideLoading();
    state.allProjects = snap.docs.map(d => ({ id: d.id, ...d.data(), _ref: d.ref }));
    debounceRender(renderDashboard);
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });

  // 2. Listen to all tasks across all projects via collectionGroup
  const taskQ = query(collectionGroup(db, 'tasks'));
  state.dashUnsubTasks = onSnapshot(taskQ, snap => {
    setOnline(); hideLoading();
    state.allTasks = snap.docs.map(d => ({ id: d.id, ...d.data(), _projectId: d.ref.parent.parent.id, _clientId: d.ref.parent.parent.parent.parent.id }));
    debounceRender(renderDashboard);
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });
}

function subscribeClients() {
  const q = query(clientsRef(), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(q, snap => {
    setOnline(); hideLoading();
    state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const badge = document.getElementById('total-badge');
    if (badge) badge.textContent = state.clients.length;
    renderClients();
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });
}

function subscribeProjects() {
  const backBtn = document.getElementById('btn-back-projects');
  if (backBtn) {
    backBtn.style.display = state.client ? 'inline-flex' : 'none';
  }

  // Clear sub listeners
  if (state.projUnsub) { state.projUnsub(); state.projUnsub = null; }
  if (state.taskUnsub) { state.taskUnsub(); state.taskUnsub = null; }

  // Clear stale data immediately so old client's data doesn't flash
  state.projects = [];
  state.tasks = [];
  renderProjects();

  if (state.client) {
    // 1. Specific client projects
    const q = query(projectsRef(state.client.id), orderBy('createdAt', 'desc'));
    state.unsubscribe = onSnapshot(q, snap => {
      setOnline(); hideLoading();
      state.projects = snap.docs.map(d => ({ id: d.id, ...d.data(), _clientId: state.client.id }));
      debounceRender(renderProjects);
    }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });

    // Also load all tasks for these projects to show progress
    state.taskUnsub = onSnapshot(query(collectionGroup(db, 'tasks')), taskSnap => {
      state.tasks = taskSnap.docs.map(t => ({ id: t.id, ...t.data(), _projectId: t.ref.parent.parent.id }));
      debounceRender(renderProjects);
    }, err => console.error(err));
  } else {
    // 2. All projects mode
    const clientQ = query(clientsRef(), orderBy('createdAt', 'desc'));
    state.unsubscribe = onSnapshot(clientQ, snap => {
      setOnline(); hideLoading();
      state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const badge = document.getElementById('total-badge');
      if (badge) badge.textContent = state.clients.length;
      debounceRender(renderProjects);
    }, err => { setOffline(); hideLoading(); console.error(err); });

    state.projUnsub = onSnapshot(query(collectionGroup(db, 'projects')), projSnap => {
      state.projects = projSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        _ref: d.ref,
        _clientId: d.ref.parent.parent.id
      }));
      debounceRender(renderProjects);
    }, err => console.error(err));

    state.taskUnsub = onSnapshot(query(collectionGroup(db, 'tasks')), taskSnap => {
      state.tasks = taskSnap.docs.map(t => ({ id: t.id, ...t.data(), _projectId: t.ref.parent.parent.id }));
      debounceRender(renderProjects);
    }, err => console.error(err));
  }
}

function subscribeTasks() {
  // Clear stale data immediately so old project's tasks don't flash
  state.tasks = [];
  renderKanban();

  if (!state.client?.id || !state.project?.id) {
    hideLoading();
    toast('تعذّر فتح المهام: لم يتم تحديد المشروع', 'error');
    navigateTo('dashboard');
    return;
  }

  const q = query(tasksRef(state.client.id, state.project.id), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(q, snap => {
    setOnline(); hideLoading();
    state.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    debounceRender(renderKanban);
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });

  // v19.5 — Live-listen to the project doc itself so the hours gauge bumps
  // whenever saveFocusHours() increments totalProjectHours from any tab.
  state.projUnsub = onSnapshot(projectDoc(state.client.id, state.project.id), snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    state.project = { ...state.project, ...data, id: snap.id };
    const idx = state.allProjects.findIndex(p => p.id === snap.id);
    if (idx >= 0) state.allProjects[idx] = { ...state.allProjects[idx], ...data };
    renderProjectHoursGauge();
  }, err => console.error('project gauge listener:', err));
}

// ════════════════════════════════════════════════════════════════
//  RENDER — DASHBOARD
// ════════════════════════════════════════════════════════════════

function renderDashboard() {
  if (state.view !== 'dashboard') return;

  // ── Time-based greeting ──
  const greetEl = document.getElementById('dash-greeting');
  if (greetEl) {
    const h = new Date().getHours();
    let text;
    if (h >= 5 && h < 12)       text = 'صباح الخير ☀️';
    else if (h >= 12 && h < 17) text = 'مساء النور 🌤️';
    else if (h >= 17 && h < 22) text = 'مساء الخير 🌙';
    else                        text = 'ليلة هادئة ✨';
    greetEl.textContent = text;
  }

  // v22.0 — Old donut deleted. Hours tracking now lives entirely on the
  // per-project linear gauge inside the kanban toolbar.
  // ── Active session widget mirror ──
  syncDashActiveSession();
  return;
}
function _legacyRenderDashboard_unused() {
  if (state.view !== 'dashboard') return;
  const totalClients   = state.clients.length;
  const activeProjects = state.allProjects.filter(p => p.status === 'active' || !p.status);
  const totalTodo      = state.allTasks.filter(t => t.status === 'todo' || t.status === 'doing').length;
  const totalDone      = state.allTasks.filter(t => t.status === 'done').length;

  animateCount('dash-total-clients',   totalClients);
  animateCount('dash-active-projects', activeProjects.length);
  animateCount('dash-total-todo',      totalTodo);
  animateCount('dash-total-done',      totalDone);

  // ── Projects List ──
  const projList  = document.getElementById('dash-proj-list');
  const projBadge = document.getElementById('dash-proj-badge');
  if (!projList) return;

  // Filter only active projects (status is 'active' or undefined/null)
  const activeProjs = state.allProjects.filter(p => p.status === 'active' || !p.status);

  // Sort: pending tasks (todo/doing) count descending, then alphabetical
  const sortedProjs = [...activeProjs].sort((a, b) => {
    const aTasks = state.allTasks.filter(t => t._projectId === a.id);
    const bTasks = state.allTasks.filter(t => t._projectId === b.id);
    const aPending = aTasks.filter(t => t.status === 'todo' || t.status === 'doing').length;
    const bPending = bTasks.filter(t => t.status === 'todo' || t.status === 'doing').length;

    if (bPending !== aPending) {
      return bPending - aPending;
    }
    return (a.name || '').localeCompare(b.name || '', 'ar');
  });

  if (projBadge) projBadge.textContent = sortedProjs.length;

  if (sortedProjs.length === 0) {
    projList.innerHTML = `
      <div class="dash-proj-empty">
        <span>📁</span>
        <p>لا توجد مشاريع جارية حالياً</p>
      </div>`;
  } else {
    projList.innerHTML = sortedProjs.map(project => {
      const clientId   = project._clientId || project._ref?.parent?.parent?.id;
      const client     = state.clients.find(c => c.id === clientId);
      const clientName = client ? escapeHtml(client.name) : '';

      const projectTasks = state.allTasks.filter(t => t._projectId === project.id);
      const pendingTasks = projectTasks.filter(t => t.status === 'todo' || t.status === 'doing').length;
      const doneTasks    = projectTasks.filter(t => t.status === 'done').length;
      const totalTasks   = projectTasks.length;
      const pct          = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
      const pctClass     = pct < 30 ? 'progress-low' : pct < 75 ? 'progress-mid' : 'progress-high';

      // Time spent badge — neutral accent color (not a warning)
      const projHours = Number(project.totalProjectHours) || 0;
      const timeBadge = projHours > 0
        ? `<span class="proj-strip-pct-badge" style="color: var(--accent); border-color: rgba(53,116,240,0.2); background: rgba(53,116,240,0.06);" title="إجمالي ساعات التركيز">⏱️ ${formatHours(projHours)}</span>`
        : '';

      return `
        <div class="dash-proj-strip-row" data-id="${project.id}" data-client-id="${clientId || ''}" role="button" tabindex="0">
          <div class="proj-strip-left">
            <span class="dash-proj-status-dot status-active"></span>
            <div class="proj-strip-names-row">
              <span class="proj-strip-project-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
              ${clientName ? `
                <span class="proj-strip-separator">/</span>
                <span class="proj-strip-client-name" title="${clientName}">${clientName}</span>
              ` : ''}
            </div>
          </div>
          <div class="proj-strip-right">
            ${timeBadge}
            <span class="proj-strip-pct-badge" title="نسبة الإنجاز">${pct}%</span>
            <span class="proj-strip-tasks-badge ${pendingTasks > 0 ? 'has-pending' : ''}">
              ${pendingTasks} معلقة
            </span>
          </div>
          <div class="proj-strip-micro-bar">
            <div class="proj-strip-micro-fill ${pctClass}" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    // Click to open tasks
    projList.querySelectorAll('.dash-proj-strip-row[data-id]').forEach(row => {
      const handler = () => {
        const project  = state.allProjects.find(p => p.id === row.dataset.id);
        const clientId = row.dataset.clientId;
        const client   = state.clients.find(c => c.id === clientId);
        if (project && client) {
          navigateTo('tasks', { client, project, fromDashboard: true });
        }
      };
      row.addEventListener('click', handler);
      row.addEventListener('keydown', e => { if (e.key === 'Enter') handler(); });
    });
  }

  // ── Productivity & Recent Activities ──
  const cntTodo  = state.allTasks.filter(t => t.status === 'todo').length;
  const cntDoing = state.allTasks.filter(t => t.status === 'doing').length;
  const cntDone  = state.allTasks.filter(t => t.status === 'done').length;
  const totalAll = cntTodo + cntDoing + cntDone;

  let todoPct = 0, doingPct = 0, donePct = 0;
  if (totalAll > 0) {
    todoPct  = Math.round((cntTodo / totalAll) * 100);
    doingPct = Math.round((cntDoing / totalAll) * 100);
    donePct  = 100 - todoPct - doingPct;
  }

  const prodBar = document.getElementById('dash-productivity-bar');
  if (prodBar) {
    prodBar.innerHTML = `
      <div class="productivity-bar-wrap">
        <div class="productivity-bar">
          <div class="prod-bar-segment todo" style="width: ${todoPct}%" title="المطلوب: ${cntTodo}"></div>
          <div class="prod-bar-segment doing" style="width: ${doingPct}%" title="جاري التنفيذ: ${cntDoing}"></div>
          <div class="prod-bar-segment done" style="width: ${donePct}%" title="تم الانتهاء: ${cntDone}"></div>
        </div>
        <div class="productivity-legends">
          <span class="legend-item"><span class="legend-dot todo"></span> المطلوب (${cntTodo})</span>
          <span class="legend-item"><span class="legend-dot doing"></span> جاري (${cntDoing})</span>
          <span class="legend-item"><span class="legend-dot done"></span> مكتمل (${cntDone})</span>
        </div>
      </div>`;
  }

  const recentContainer = document.getElementById('dash-recent-tasks');
  if (recentContainer) {
    const getTime = (val) => val && typeof val.toDate === 'function' ? val.toDate().getTime() : (val ? new Date(val).getTime() : 0);
    const recentTasks = [...state.allTasks]
      .filter(t => t.status === 'todo' || t.status === 'doing')
      .sort((a,b) => getTime(b.createdAt) - getTime(a.createdAt))
      .slice(0, 4);

    if (recentTasks.length === 0) {
      recentContainer.innerHTML = '<div class="dash-proj-empty" style="padding:10px;"><p style="font-size:11px;">لا توجد مهام نشطة حالياً</p></div>';
    } else {
      recentContainer.innerHTML = recentTasks.map(task => {
        const project = state.allProjects.find(p => p.id === task._projectId);
        const client  = state.clients.find(c => c.id === task._clientId);
        const projName = project ? project.name : 'مشروع عام';
        const dotCls = task.status === 'doing' ? 'doing' : 'todo';

        return `
          <div class="recent-task-item" data-project-id="${task._projectId}" data-client-id="${task._clientId || ''}" role="button" tabindex="0">
            <div class="recent-task-title-wrap">
              <span class="recent-task-dot ${dotCls}"></span>
              <span class="recent-task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
            </div>
            <span class="recent-task-meta" title="${escapeHtml(projName)}">${escapeHtml(projName)}</span>
          </div>`;
      }).join('');

      recentContainer.querySelectorAll('.recent-task-item').forEach(item => {
        item.addEventListener('click', () => {
          const project = state.allProjects.find(p => p.id === item.dataset.projectId);
          const clientId = item.dataset.clientId;
          const client   = state.clients.find(c => c.id === clientId);
          if (project && client) {
            navigateTo('tasks', { client, project, fromDashboard: true });
          }
        });
        item.addEventListener('keydown', e => { if (e.key === 'Enter') item.click(); });
      });
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  ACTIVE SESSION MIRROR (Dashboard widget)
// ════════════════════════════════════════════════════════════════

function syncDashActiveSession() {
  const widget = document.getElementById('dash-active-session');
  if (!widget) return;

  // Show only when a timer is actively running OR paused mid-session
  const hasSession = state.focusRunning
    || (state.focusTimeLeft !== state.focusWorkMinutes * 60
        && state.focusTimeLeft !== state.focusBreakMinutes * 60);

  if (!hasSession) {
    widget.classList.add('hidden');
    return;
  }
  widget.classList.remove('hidden');
  widget.classList.toggle('break-mode', state.focusState === 'break');

  const minEl = document.getElementById('active-session-minutes');
  const secEl = document.getElementById('active-session-seconds');
  const lblEl = document.getElementById('active-session-label');
  const m = Math.floor(state.focusTimeLeft / 60);
  const s = state.focusTimeLeft % 60;
  if (minEl) minEl.textContent = String(m).padStart(2, '0');
  if (secEl) secEl.textContent = String(s).padStart(2, '0');
  if (lblEl) {
    if (state.focusState === 'break') {
      lblEl.textContent = state.focusRunning ? 'وقت الراحة الآن ☕' : 'جلسة راحة موقوفة';
    } else {
      lblEl.textContent = state.focusRunning ? 'جاري العمل الآن 🔥' : 'جلسة موقوفة';
    }
  }

  const pauseBtn = document.getElementById('active-session-pause');
  if (pauseBtn) pauseBtn.textContent = state.focusRunning ? '⏸️' : '▶️';
}

(function setupActiveSessionControls() {
  const pauseBtn = document.getElementById('active-session-pause');
  const resetBtn = document.getElementById('active-session-reset');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (state.focusRunning) pauseFocusTimer();
      else                    startFocusTimer();
    });
  }
  if (resetBtn) resetBtn.addEventListener('click', () => resetFocusTimer());
})();

// ════════════════════════════════════════════════════════════════
//  CALENDAR + DAY VIEW (v9.2)
// ════════════════════════════════════════════════════════════════

function subscribeCalendar() {
  // Reuse same listeners as the dashboard — we need clients, projects, tasks
  if (state.dashUnsubProjects || state.dashUnsubTasks || state.unsubscribe) {
    // Already loaded by dashboard subscriptions — just render
    renderCalendar();
    if (state.view === 'day') renderDayView();
    return;
  }

  const renderCalAndDay = () => {
    renderCalendar();
    if (state.view === 'day') renderDayView();
  };

  const clientQ = query(clientsRef(), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(clientQ, snap => {
    setOnline(); hideLoading();
    state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const badge = document.getElementById('total-badge');
    if (badge) badge.textContent = state.clients.length;
    debounceRender(renderCalAndDay);
  }, err => { setOffline(); hideLoading(); console.error(err); });

  state.dashUnsubProjects = onSnapshot(query(collectionGroup(db, 'projects')), snap => {
    setOnline(); hideLoading();
    state.allProjects = snap.docs.map(d => ({ id: d.id, ...d.data(), _ref: d.ref, _clientId: d.ref.parent.parent.id }));
    debounceRender(renderCalAndDay);
  }, err => { setOffline(); hideLoading(); console.error(err); });

  state.dashUnsubTasks = onSnapshot(query(collectionGroup(db, 'tasks')), snap => {
    setOnline(); hideLoading();
    state.allTasks = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      _projectId: d.ref.parent.parent.id,
      _clientId:  d.ref.parent.parent.parent.parent.id
    }));
    debounceRender(renderCalAndDay);
  }, err => { setOffline(); hideLoading(); console.error(err); });
}

function parseDateField(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameYMD(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function tasksOnDate(date) {
  const target = startOfDay(date).getTime();
  return state.allTasks.filter(t => {
    const sd = parseDateField(t.startDate);
    if (!sd) return false;
    const start = startOfDay(sd).getTime();
    const ed = parseDateField(t.endDate);
    const end = ed ? startOfDay(ed).getTime() : start;
    return target >= start && target <= end;
  });
}

function renderCalendar() {
  if (state.view !== 'calendar' && state.view !== 'day') return;

  const grid  = document.getElementById('calendar-grid');
  const label = document.getElementById('cal-month-label');
  if (!grid || !label) return;

  const cursor = state.calendarCursor || new Date();
  const year   = cursor.getFullYear();
  const month  = cursor.getMonth();

  label.textContent = cursor.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });

  // Saturday-first layout (Arabic week): JS Sunday=0..Saturday=6 → shift to (day+1)%7
  const firstOfMonth   = new Date(year, month, 1);
  const startWeekday   = (firstOfMonth.getDay() + 1) % 7;
  const daysInMonth    = new Date(year, month + 1, 0).getDate();
  const today          = startOfDay(new Date());

  // Pad with trailing days of previous month
  const prevMonthDays  = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevMonthDays - i), other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), other: false });
  }
  while (cells.length % 7 !== 0) {
    const i = cells.length - (startWeekday + daysInMonth) + 1;
    cells.push({ date: new Date(year, month + 1, i), other: true });
  }

  grid.innerHTML = cells.map(({ date, other }) => {
    const isToday = sameYMD(date, today);
    const tasksToday = tasksOnDate(date);

    // v19.5 — Visual summary only: collapse tasks into the unique set of
    // CLIENT AVATARS responsible for them. Text titles are gone from the
    // monthly grid — click into a day to see the full list.
    const seen = new Set();
    const clientsForDay = [];
    for (const t of tasksToday) {
      const cid = t._clientId;
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      clientsForDay.push(state.clients.find(c => c.id === cid));
    }

    const avatars = clientsForDay.filter(Boolean).map(c => {
      const inner = c.avatarUrl
        ? `<img src="${c.avatarUrl}" alt="${escapeHtml(c.name || '')}" />`
        : escapeHtml(getInitials(c.name || '—'));
      const bg = c.avatarUrl ? 'transparent' : escapeHtml(c.color || '#3574F0');
      return `<span class="cal-client-avatar" style="background:${bg}" title="${escapeHtml(c.name || '')}">${inner}</span>`;
    }).join('');

    return `
      <div class="cal-day ${other ? 'other-month' : ''} ${isToday ? 'today' : ''}"
           data-date="${date.toISOString()}" role="button" tabindex="0">
        <div class="cal-day-num">
          <span>${date.getDate()}</span>
          ${tasksToday.length > 0 ? `<span class="cal-day-count">${tasksToday.length}</span>` : ''}
        </div>
        <div class="cal-day-clients">
          ${avatars}
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.cal-day[data-date]').forEach(cell => {
    const handler = () => {
      const d = new Date(cell.dataset.date);
      navigateTo('day', { date: d });
    };
    cell.addEventListener('click', handler);
    cell.addEventListener('keydown', e => { if (e.key === 'Enter') handler(); });
  });
}

function renderDayView() {
  if (state.view !== 'day') return;
  const titleEl = document.getElementById('day-title');
  const blocks  = document.getElementById('day-blocks');
  if (!titleEl || !blocks) return;

  const date = state.dayDate || new Date();
  titleEl.textContent = date.toLocaleDateString('ar-EG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const items = tasksOnDate(date);
  if (items.length === 0) {
    blocks.innerHTML = `
      <div class="day-empty" style="grid-column: 1 / -1;">
        <div class="day-empty-icon">📭</div>
        <p>لا توجد مهام في هذا اليوم</p>
      </div>`;
    return;
  }

  // Group: (clientId, projectId) → tasks[]
  const groupMap = new Map();   // key = `${cid}::${pid}`
  for (const t of items) {
    const cid = t._clientId || 'unknown';
    const pid = t._projectId || 'unknown';
    const key = `${cid}::${pid}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { clientId: cid, projectId: pid, tasks: [] });
    }
    groupMap.get(key).tasks.push(t);
  }

  // Sort tasks inside each block: doing > todo > done, then title
  const statusRank = { doing: 0, todo: 1, done: 2 };
  for (const g of groupMap.values()) {
    g.tasks.sort((a, b) => {
      const sa = statusRank[a.status] ?? 1;
      const sb = statusRank[b.status] ?? 1;
      if (sa !== sb) return sa - sb;
      return (a.title || '').localeCompare(b.title || '', 'ar');
    });
  }

  // Order blocks by the project's saved `order` field (v14.0)
  const orderedGroups = [...groupMap.values()].sort((a, b) => {
    const ap = state.allProjects.find(p => p.id === a.projectId);
    const bp = state.allProjects.find(p => p.id === b.projectId);
    const ao = ap?.order ?? 9999;
    const bo = bp?.order ?? 9999;
    return ao - bo;
  });

  blocks.innerHTML = orderedGroups.map(({ clientId, projectId, tasks }) => {
    const client      = state.clients.find(c => c.id === clientId);
    const project     = state.allProjects.find(p => p.id === projectId);
    const clientName  = client  ? escapeHtml(client.name)  : '— عميل غير معروف —';
    const projectName = project ? escapeHtml(project.name) : '— مشروع —';

    // Avatar: client photo if available, else colored initials
    const avatarStyle = client?.avatarUrl
      ? 'background: transparent;'
      : `background: ${escapeHtml(client?.color || '#3574F0')};`;
    const avatarInner = client?.avatarUrl
      ? `<img src="${client.avatarUrl}" alt="${clientName}" />`
      : escapeHtml(getInitials(client?.name || '—'));

    const doneCount = tasks.filter(t => t.status === 'done').length;
    const cards = tasks.length
      ? tasks.map(dayTaskCardHTML).join('')
      : `<div class="day-block-empty">لا توجد مهام بعد</div>`;

    return `
      <div class="day-block" draggable="true"
           data-client="${clientId}" data-project="${projectId}">
        <div class="day-block-header" title="اسحب هذا الكارت لإعادة ترتيب المشاريع">
          <div class="day-block-avatar" style="${avatarStyle}">${avatarInner}</div>
          <div class="day-block-titles">
            <div class="day-block-project">${projectName}</div>
            <div class="day-block-client" title="${clientName}">👤 ${clientName}</div>
          </div>
        </div>
        <div class="day-block-body">
          ${cards}
        </div>
        <div class="day-block-meta">
          <span>${doneCount} / ${tasks.length} مكتملة</span>
          <span class="day-block-count-badge">${tasks.length} مهمة</span>
        </div>
      </div>`;
  }).join('');

  bindDayBlockEvents();
}

function dayTaskCardHTML(task) {
  const status    = task.status || 'todo';
  // v19.0 — Hours are tracked per-project only. No more per-task time badge.
  const statusLabel = { todo: 'مطلوب', doing: 'جاري', done: 'تم' }[status] || '';

  // v17.0 — Instant "Done" button (calendar-only). Hidden when already done.
  const doneBtn = status !== 'done'
    ? `<button class="day-task-done-btn" data-id="${task.id}"
               data-client="${task._clientId || ''}"
               data-project="${task._projectId || ''}"
               title="إنهاء المهمة فوراً" aria-label="تحويل لـ Done">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
           <polyline points="20 6 9 17 4 12"></polyline>
         </svg>
       </button>`
    : '';

  return `
    <div class="day-task-card status-${status}"
         draggable="true"
         data-id="${task.id}"
         data-client="${task._clientId || ''}"
         data-project="${task._projectId || ''}">
      <div class="day-task-card-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
      <div class="day-task-card-meta">
        <span>● ${statusLabel}</span>
        ${doneBtn}
      </div>
    </div>`;
}

function bindDayBlockEvents() {
  // v17.0 — Instant Done button (calendar-only) inside each day-task card.
  document.querySelectorAll('#day-blocks .day-task-done-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cid = btn.dataset.client;
      const pid = btn.dataset.project;
      const tid = btn.dataset.id;
      if (!cid || !pid || !tid) return;
      btn.disabled = true;
      try {
        await updateDoc(taskDoc(cid, pid, tid), { status: 'done' });
        // Optimistic visual: drop opacity until the snapshot re-renders.
        btn.closest('.day-task-card')?.classList.add('status-done');
      } catch (err) {
        toast('فشل تحديث الحالة', 'error');
        console.error(err);
        btn.disabled = false;
      }
    });
    // Don't let drag interaction start from the button.
    btn.addEventListener('mousedown', e => e.stopPropagation());
    btn.addEventListener('dragstart', e => { e.preventDefault(); e.stopPropagation(); });
  });

  // Card drag start/end + double-click to open the project's kanban
  document.querySelectorAll('#day-blocks .day-task-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      // Stop the parent .day-block dragstart from also firing
      e.stopPropagation();
      state.dayDraggedId        = card.dataset.id;
      state.dayDraggedClientId  = card.dataset.client;
      state.dayDraggedProjectId = card.dataset.project;
      state.dayDragKind         = 'task';
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (_) {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      state.dayDraggedId = null;
      state.dayDraggedClientId = null;
      state.dayDraggedProjectId = null;
      state.dayDragKind = null;
      document.querySelectorAll('#day-blocks .day-block').forEach(b => b.classList.remove('drag-over', 'drop-forbidden', 'block-drag-target'));
    });
    card.addEventListener('dblclick', () => {
      const client  = state.clients.find(c => c.id === card.dataset.client);
      const project = state.allProjects.find(p => p.id === card.dataset.project);
      if (client && project) navigateTo('tasks', { client, project, fromDashboard: true });
    });
  });

  // ── Block-level DnD: both task strict-same-project + block reorder (v14.0) ──
  // v22.0 — A global cleanup helper so stuck state (e.g. snapshot mid-drag
  // wiping the source DOM node before its dragend fires) can never poison
  // the next drag.
  const clearBlockDragState = () => {
    state.dayDraggedBlockClient  = null;
    state.dayDraggedBlockProject = null;
    state.dayDragKind            = null;
    document.getElementById('day-blocks')?.classList.remove('is-dragging');
    document.querySelectorAll('#day-blocks .day-block').forEach(b =>
      b.classList.remove('drag-over', 'drop-forbidden', 'block-drag-target', 'dragging'));
  };

  // v22.0 — Container-level dragover so a drop anywhere inside #day-blocks
  // counts (not just on a block). Stops the OS "no-drop" cursor when the
  // pointer skims gap space between cards mid-reorder.
  const blocksContainer = document.getElementById('day-blocks');
  if (blocksContainer && !blocksContainer._dnDWired) {
    blocksContainer._dnDWired = true;
    blocksContainer.addEventListener('dragover', e => {
      if (state.dayDragKind === 'block') {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    blocksContainer.addEventListener('drop', e => {
      // If the drop didn't land on a child block, clean up so we don't stay stuck
      if (state.dayDragKind === 'block') {
        e.preventDefault();
        clearBlockDragState();
      }
    });
  }

  document.querySelectorAll('#day-blocks .day-block').forEach(block => {
    const targetClient  = block.dataset.client;
    const targetProject = block.dataset.project;

    // The block itself is draggable → start block-reorder
    block.addEventListener('dragstart', e => {
      // If a task card inside started the drag, skip (it set dayDragKind='task' already)
      if (state.dayDragKind === 'task') return;
      state.dayDragKind             = 'block';
      state.dayDraggedBlockClient   = targetClient;
      state.dayDraggedBlockProject  = targetProject;
      block.classList.add('dragging');
      // v21.0 — Mark the container so sibling-lock CSS kicks in
      document.getElementById('day-blocks')?.classList.add('is-dragging');
      e.dataTransfer.effectAllowed  = 'move';
      try { e.dataTransfer.setData('text/plain', `block:${targetProject}`); } catch (_) {}
    });

    block.addEventListener('dragend', () => {
      clearBlockDragState();
    });

    block.addEventListener('dragover', e => {
      if (state.dayDragKind === 'block') {
        // Block reorder — accept any other block
        if (state.dayDraggedBlockProject === targetProject) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        block.classList.add('block-drag-target');
      } else if (state.dayDragKind === 'task') {
        // Task drag — strict same project
        const sameProject = state.dayDraggedClientId === targetClient
                         && state.dayDraggedProjectId === targetProject;
        if (sameProject) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          block.classList.add('drag-over');
          block.classList.remove('drop-forbidden');
        } else {
          e.dataTransfer.dropEffect = 'none';
          block.classList.add('drop-forbidden');
          block.classList.remove('drag-over');
        }
      }
    });

    block.addEventListener('dragleave', e => {
      if (!block.contains(e.relatedTarget)) {
        block.classList.remove('drag-over', 'drop-forbidden', 'block-drag-target');
      }
    });

    block.addEventListener('drop', async e => {
      block.classList.remove('drag-over', 'drop-forbidden', 'block-drag-target');

      if (state.dayDragKind === 'block') {
        const fromProject = state.dayDraggedBlockProject;
        e.preventDefault();
        // Snapshot the source id BEFORE we clear, because clearBlockDragState
        // (or the snapshot-driven re-render that follows) will wipe state.
        clearBlockDragState();
        if (!fromProject || fromProject === targetProject) return;
        await reorderDayProjectBlocks(fromProject, targetProject);
        return;
      }

      // Task drop — strict same-project
      const sameProject = state.dayDraggedClientId === targetClient
                       && state.dayDraggedProjectId === targetProject;
      if (!sameProject) return;   // silent cancel — strict v13.0 rule
      e.preventDefault();
    });
  });
}

async function reorderDayProjectBlocks(fromProjectId, toProjectId) {
  // Get the current displayed order of projects in #day-blocks
  const blockEls  = [...document.querySelectorAll('#day-blocks .day-block')];
  const orderIds  = blockEls.map(b => b.dataset.project);

  const fromIdx = orderIds.indexOf(fromProjectId);
  const toIdx   = orderIds.indexOf(toProjectId);
  if (fromIdx === -1 || toIdx === -1) return;

  // Splice the dragged id to the target position
  orderIds.splice(fromIdx, 1);
  orderIds.splice(toIdx, 0, fromProjectId);

  // Persist new order to each project's doc
  const batch = writeBatch(db);
  orderIds.forEach((pid, idx) => {
    const proj = state.allProjects.find(p => p.id === pid);
    if (!proj) return;
    const cid = proj._clientId || proj._ref?.parent?.parent?.id;
    if (!cid) return;
    // Optimistic in-memory update so renderDayView() shows the new order immediately
    proj.order = idx;
    batch.update(projectDoc(cid, pid), { order: idx });
  });

  // Re-render right away (optimistic)
  renderDayView();

  try {
    await batch.commit();
  } catch (err) {
    console.error('Failed to save project block order:', err);
    toast('فشل حفظ الترتيب الجديد', 'error');
  }
}

// ── Wire calendar controls (idempotent) ──
(function setupCalendarControls() {
  const portal = document.getElementById('dash-portal-calendar');
  if (portal) {
    const go = () => navigateTo('calendar');
    portal.addEventListener('click', go);
    portal.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }

  const prev = document.getElementById('cal-prev-month');
  const next = document.getElementById('cal-next-month');
  const today = document.getElementById('cal-today-btn');
  const backCal = document.getElementById('btn-back-calendar');
  const backDay = document.getElementById('btn-back-day');

  if (prev)  prev .addEventListener('click', () => {
    const c = state.calendarCursor || new Date();
    state.calendarCursor = new Date(c.getFullYear(), c.getMonth() - 1, 1);
    renderCalendar();
  });
  if (next)  next .addEventListener('click', () => {
    const c = state.calendarCursor || new Date();
    state.calendarCursor = new Date(c.getFullYear(), c.getMonth() + 1, 1);
    renderCalendar();
  });
  if (today) today.addEventListener('click', () => {
    state.calendarCursor = new Date();
    renderCalendar();
  });
  if (backCal) backCal.addEventListener('click', () => navigateTo('dashboard'));
  if (backDay) backDay.addEventListener('click', () => navigateTo('calendar'));
})();

// ════════════════════════════════════════════════════════════════
//  FINANCE HUB (v25.0 — Dynamic Buckets)
//  Income sources stay (salaries + freelance hours×rate). Expenses
//  were re-modelled into:
//    - budget_buckets  — user-defined categories with optional
//      targetBudget and active/archived status.
//    - transactions    — each spend points at a bucketId; the bucket's
//      name/colour/icon are looked up live, never hardcoded.
//  Archived buckets disappear from the spend dropdown and headline
//  cards but their historic transactions stay intact.
// ════════════════════════════════════════════════════════════════

// Palette cycled through new buckets so each gets a distinct
// PhpStorm-friendly accent without the user having to pick one.
const BUCKET_PALETTE = [
  { color: '#E891C8', icon: '👰' },
  { color: '#E05C5C', icon: '🏠' },
  { color: '#F0A835', icon: '🍔' },
  { color: '#5C8DEC', icon: '🧠' },
  { color: '#3DB981', icon: '🛠️' },
  { color: '#B58CDC', icon: '🎯' },
  { color: '#54C6C2', icon: '🧾' },
  { color: '#D1A45A', icon: '✈️' },
];

function bucketPaletteEntry(seed) {
  // Stable hash from id so the same bucket always gets the same colour.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return BUCKET_PALETTE[Math.abs(h) % BUCKET_PALETTE.length];
}

function bucketVisual(bucket) {
  if (!bucket) return { color: '#6F727A', icon: '🗂️', label: '— محذوف —' };
  const fallback = bucketPaletteEntry(bucket.id || bucket.bucketName || '');
  return {
    color: bucket.color || fallback.color,
    icon:  bucket.icon  || fallback.icon,
    label: bucket.bucketName || '— بدون اسم —',
  };
}

// Format money — Arabic-friendly, tabular, with thousands grouping.
function formatMoney(n) {
  const v = Number(n) || 0;
  const rounded = Math.round(v * 100) / 100;
  const hasDec  = rounded % 1 !== 0;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: hasDec ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}

function subscribeFinance() {
  // Need clients/projects too so we can resolve freelance sources
  if (!state.dashUnsubProjects && !state.unsubscribe) {
    const clientQ = query(clientsRef(), orderBy('createdAt', 'desc'));
    state.unsubscribe = onSnapshot(clientQ, snap => {
      setOnline(); hideLoading();
      state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      debounceRender(renderFinance);
    }, err => { setOffline(); hideLoading(); console.error(err); });

    state.dashUnsubProjects = onSnapshot(query(collectionGroup(db, 'projects')), snap => {
      setOnline(); hideLoading();
      state.allProjects = snap.docs.map(d => ({
        id: d.id, ...d.data(), _ref: d.ref, _clientId: d.ref.parent.parent.id,
      }));
      debounceRender(renderFinance);
    }, err => { setOffline(); hideLoading(); console.error(err); });
  } else {
    hideLoading();
    debounceRender(renderFinance);
  }

  state.financeUnsubIncome = onSnapshot(query(incomeSourcesRef(), orderBy('createdAt', 'desc')), snap => {
    state.incomeSources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    debounceRender(renderFinance);
  }, err => { console.error('income sources listener:', err); toast('فشل تحميل مصادر الدخل', 'error'); });

  state.financeUnsubBuckets = onSnapshot(query(bucketsRef(), orderBy('createdAt', 'desc')), snap => {
    state.buckets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    debounceRender(renderFinance);
  }, err => {
    console.error('buckets listener:', err);
    if (err?.code === 'permission-denied') {
      toast('⚠️ Firestore rules ناقصة لـ budget_buckets — انشر الـ rules', 'error');
    }
  });

  state.financeUnsubTx = onSnapshot(query(transactionsRef(), orderBy('date', 'desc')), snap => {
    state.transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    debounceRender(renderFinance);
  }, err => {
    console.error('transactions listener:', err);
    if (err?.code === 'permission-denied') {
      toast('⚠️ Firestore rules ناقصة لـ transactions — انشر الـ rules', 'error');
    }
  });
}

// v26.0 — Single source of truth for a freelance income row's earnings.
// Picks pricingType off the linked project first; legacy income docs that
// still store hourlyRate locally keep working as a last-resort fallback.
function computeFreelanceEarning(source) {
  const proj = state.allProjects.find(p => p.id === source.projectId);
  if (!proj) return 0;
  let ptype = proj.pricingType;
  if (!ptype) {
    if (Number(proj.hourlyRate) > 0)              ptype = 'hourly';
    else if (Number(proj.projectFixedPrice) > 0)  ptype = 'fixed';
    else if (Number(source.hourlyRate) > 0)       ptype = 'hourly-legacy';
    else return 0;
  }
  if (ptype === 'fixed') {
    return Number(proj.projectFixedPrice) || 0;
  }
  const rate  = Number(proj.hourlyRate) || Number(source.hourlyRate) || 0;
  const hours = Number(proj.totalProjectHours) || 0;
  return rate * hours;
}

// ── Computed totals ──────────────────────────────────────────────
function computeFinanceTotals() {
  // Salary income: every salary source contributes its monthlyAmount.
  const salaryTotal = state.incomeSources
    .filter(s => s.type === 'salary')
    .reduce((sum, s) => sum + (Number(s.monthlyAmount) || 0), 0);

  // v26.0 — Freelance income now reads pricingType from the project doc.
  // Hourly  → totalProjectHours × hourlyRate
  // Fixed   → projectFixedPrice as-is, hours are personal-effort signal only.
  // Backward compat: if project has no pricingType, fall back to source.hourlyRate.
  const freelanceTotal = state.incomeSources
    .filter(s => s.type === 'freelance')
    .reduce((sum, s) => sum + computeFreelanceEarning(s), 0);

  const totalIncome = salaryTotal + freelanceTotal;

  // Per-bucket spend (dynamic — keyed by bucketId, falls back to "unassigned")
  const byBucket = new Map();
  state.transactions.forEach(t => {
    const id = t.bucketId || '__unassigned__';
    byBucket.set(id, (byBucket.get(id) || 0) + (Number(t.amount) || 0));
  });
  const totalExpense = state.transactions
    .reduce((a, t) => a + (Number(t.amount) || 0), 0);

  return {
    salaryTotal, freelanceTotal, totalIncome,
    byBucket, totalExpense,
    net: totalIncome - totalExpense,
  };
}

// ── Top-level finance render ──────────────────────────────────────
function renderFinance() {
  if (state.view !== 'finance') return;

  const tag = document.getElementById('finance-month-tag');
  if (tag) {
    const cur = state.financeCursor || new Date();
    tag.textContent = cur.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
  }

  const t = computeFinanceTotals();

  // 3 fixed headline cards (dynamic per-bucket cards render below)
  setText('fin-stat-income', formatMoney(t.totalIncome));
  setText('fin-stat-income-sub', `راتب ${formatMoney(t.salaryTotal)} • مشاريع ${formatMoney(t.freelanceTotal)}`);
  setText('fin-stat-spent', formatMoney(t.totalExpense));
  setText('fin-stat-spent-sub', `${state.transactions.length} عملية`);
  setText('fin-stat-net', formatMoney(t.net));
  const netEl = document.getElementById('fin-stat-net');
  if (netEl) {
    netEl.classList.toggle('negative', t.net < 0);
    netEl.classList.toggle('positive', t.net >= 0);
  }
  setText('fin-stat-net-sub', t.net >= 0 ? 'مساحة آمنة' : 'تجاوز الميزانية ⚠️');

  renderFinanceBuckets(t);
  renderFinanceIncomeList();
  renderFinanceTransactions();
}

// ── Dynamic bucket cards ──────────────────────────────────────────
function renderFinanceBuckets(totals) {
  const grid = document.getElementById('fin-buckets-grid');
  if (!grid) return;

  const visible = state.buckets.filter(b =>
    state.financeShowArchived ? b.status === 'archived' : b.status !== 'archived');

  // Counter label + archive toggle text
  const cnt = document.getElementById('fin-buckets-count');
  if (cnt) {
    const activeN   = state.buckets.filter(b => b.status !== 'archived').length;
    const archivedN = state.buckets.filter(b => b.status === 'archived').length;
    cnt.textContent = `${activeN} نشط${archivedN ? ` • ${archivedN} مؤرشف` : ''}`;
  }
  const toggleBtn = document.getElementById('fin-buckets-toggle-archived');
  if (toggleBtn) {
    toggleBtn.textContent = state.financeShowArchived ? '↩️ النشطة' : '🗄️ المؤرشفة';
    toggleBtn.classList.toggle('active', state.financeShowArchived);
  }

  if (visible.length === 0) {
    grid.innerHTML = `
      <div class="finance-empty" style="grid-column: 1 / -1;">
        <div class="finance-empty-icon">🗂️</div>
        <div class="finance-empty-text">
          ${state.financeShowArchived ? 'لا يوجد أوعية مؤرشفة' : 'لا يوجد أوعية صرف بعد'}
        </div>
        <div class="finance-empty-sub">
          ${state.financeShowArchived
            ? 'ارجع للنشطة وأنشئ أو ادفع لوعاء جديد'
            : 'اضغط "وعاء جديد" لإنشاء أول صندوق صرف ديناميكي'}
        </div>
      </div>`;
    return;
  }

  grid.innerHTML = visible.map(b => {
    const vis     = bucketVisual(b);
    const spent   = totals.byBucket.get(b.id) || 0;
    const target  = Number(b.targetBudget) || 0;
    const pct     = target > 0 ? Math.min(100, Math.round((spent / target) * 100)) : 0;
    const overBud = target > 0 && spent > target;
    const isArch  = b.status === 'archived';

    return `
      <div class="bucket-card ${isArch ? 'is-archived' : ''}" data-id="${b.id}"
           style="--bk-color:${vis.color};">
        <div class="bucket-card-head">
          <div class="bucket-icon">${vis.icon}</div>
          <div class="bucket-name" title="${escapeHtml(vis.label)}">${escapeHtml(vis.label)}</div>
          <div class="bucket-actions">
            <button class="bucket-action-btn" data-act="edit"    data-id="${b.id}" title="تعديل">✏️</button>
            <button class="bucket-action-btn" data-act="archive" data-id="${b.id}"
              title="${isArch ? 'استعادة' : 'أرشفة'}">${isArch ? '♻️' : '🗄️'}</button>
            <button class="bucket-action-btn danger" data-act="delete" data-id="${b.id}" title="حذف نهائي">✕</button>
          </div>
        </div>
        <div class="bucket-amounts">
          <span class="bucket-spent">${formatMoney(spent)}</span>
          ${target > 0
            ? `<span class="bucket-sep">/</span><span class="bucket-target">${formatMoney(target)}</span>`
            : `<span class="bucket-target muted">— بدون سقف —</span>`}
        </div>
        ${target > 0 ? `
          <div class="bucket-track"><div class="bucket-fill ${overBud ? 'over' : ''}"
               style="width:${pct}%"></div></div>
          <div class="bucket-meta">
            <span>${pct}% من الهدف</span>
            ${overBud ? '<span class="bucket-warn">تجاوز ⚠️</span>' : ''}
          </div>` : ''}
      </div>`;
  }).join('');

  // Wire action buttons
  grid.querySelectorAll('.bucket-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id  = btn.dataset.id;
      const act = btn.dataset.act;
      const bucket = state.buckets.find(b => b.id === id);
      if (!bucket) return;

      if (act === 'edit') {
        openModal('bucket', id);
      } else if (act === 'archive') {
        try {
          const newStatus = bucket.status === 'archived' ? 'active' : 'archived';
          await updateDoc(bucketDoc(id), { status: newStatus });
          toast(newStatus === 'archived' ? 'تم أرشفة الوعاء' : 'تم استعادة الوعاء', 'info');
        } catch (err) { console.error(err); toast('فشل التحديث', 'error'); }
      } else if (act === 'delete') {
        const txCount = state.transactions.filter(t => t.bucketId === id).length;
        const msg = txCount > 0
          ? `هذا الوعاء عليه ${txCount} عملية. الحذف النهائي ينظف الوعاء فقط ويبقي العمليات بدون ارتباط. متأكد؟`
          : 'حذف نهائي للوعاء؟';
        if (!confirm(msg)) return;
        try { await deleteDoc(bucketDoc(id)); toast('تم الحذف', 'info', '🗑️'); }
        catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
      }
    });
  });
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

// ── Income sources list ──────────────────────────────────────────
function renderFinanceIncomeList() {
  const list = document.getElementById('fin-income-list');
  const cnt  = document.getElementById('fin-income-count');
  if (!list) return;
  cnt && (cnt.textContent = `${state.incomeSources.length} مصدر`);

  if (state.incomeSources.length === 0) {
    list.innerHTML = `
      <div class="finance-empty">
        <div class="finance-empty-icon">💼</div>
        <div class="finance-empty-text">لا توجد مصادر دخل بعد</div>
        <div class="finance-empty-sub">اضغط "مصدر دخل" لإضافة راتب أو ربط مشروع حر</div>
      </div>`;
    return;
  }

  list.innerHTML = state.incomeSources.map(src => {
    if (src.type === 'salary') {
      const monthly = Number(src.monthlyAmount) || 0;
      return `
        <div class="finance-income-row" data-id="${src.id}" data-kind="salary">
          <div class="finance-income-icon salary-icon">🏢</div>
          <div class="finance-income-body">
            <div class="finance-income-title">${escapeHtml(src.label || 'راتب')}</div>
            <div class="finance-income-sub">راتب شهري ثابت</div>
          </div>
          <div class="finance-income-amount">${formatMoney(monthly)}</div>
          <button class="finance-row-del" data-id="${src.id}" data-kind="income" title="حذف">✕</button>
        </div>`;
    }
    // freelance — v26.0 reads pricingType off the project doc
    const proj   = state.allProjects.find(p => p.id === src.projectId);
    const earned = computeFreelanceEarning(src);
    const projName = proj ? proj.name : '— مشروع غير موجود —';
    const ptype  = proj?.pricingType || (Number(proj?.hourlyRate) ? 'hourly' : (Number(proj?.projectFixedPrice) ? 'fixed' : null));
    let breakdown;
    if (ptype === 'fixed') {
      breakdown = `سعر ثابت ${formatMoney(proj.projectFixedPrice)} • مجهود ${formatHoursHm(proj.totalProjectHours)}`;
    } else if (ptype === 'hourly' || ptype === 'hourly-legacy') {
      const rate = Number(proj?.hourlyRate) || Number(src.hourlyRate) || 0;
      breakdown = `${formatMoney(rate)}/س × ${formatHoursHm(proj?.totalProjectHours)}`;
    } else {
      breakdown = '⚠️ المشروع بدون تسعير — افتحه وفعّل سعر';
    }
    return `
      <div class="finance-income-row" data-id="${src.id}" data-kind="freelance">
        <div class="finance-income-icon freelance-icon">💻</div>
        <div class="finance-income-body">
          <div class="finance-income-title">${escapeHtml(src.label || projName)}</div>
          <div class="finance-income-sub">${escapeHtml(projName)} • ${breakdown}</div>
        </div>
        <div class="finance-income-amount">${formatMoney(earned)}</div>
        <button class="finance-row-del" data-id="${src.id}" data-kind="income" title="حذف">✕</button>
      </div>`;
  }).join('');

  // Wire delete buttons
  list.querySelectorAll('.finance-row-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('حذف هذا المصدر؟')) return;
      try {
        await deleteDoc(incomeSourceDoc(btn.dataset.id));
        toast('تم حذف المصدر', 'info', '🗑️');
      } catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
    });
  });
}

// ── Transactions feed ────────────────────────────────────────────
function renderFinanceTransactions() {
  const list = document.getElementById('fin-tx-list');
  const cnt  = document.getElementById('fin-tx-count');
  if (!list) return;
  cnt && (cnt.textContent = `${state.transactions.length} معاملة`);

  if (state.transactions.length === 0) {
    list.innerHTML = `
      <div class="finance-empty">
        <div class="finance-empty-icon">📋</div>
        <div class="finance-empty-text">لا توجد معاملات مسجلة بعد</div>
        <div class="finance-empty-sub">اضغط "تسجيل مصروف" لإضافة أول عملية</div>
      </div>`;
    return;
  }

  list.innerHTML = state.transactions.slice(0, 80).map(tx => {
    const bucket = state.buckets.find(b => b.id === tx.bucketId);
    const vis    = bucketVisual(bucket);
    const date   = parseDateField(tx.date);
    const dateLabel = date ? date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : '—';
    const proj   = tx.projectId ? state.allProjects.find(p => p.id === tx.projectId) : null;
    const projTag = proj ? ` • 📁 ${escapeHtml(proj.name)}` : '';
    return `
      <div class="finance-tx-row" data-id="${tx.id}" data-bucket="${tx.bucketId || ''}">
        <div class="finance-tx-icon" style="background:${vis.color}26; color:${vis.color}; border-color:${vis.color}55;">${vis.icon}</div>
        <div class="finance-tx-body">
          <div class="finance-tx-title">${escapeHtml(tx.title || '—')}</div>
          <div class="finance-tx-sub">${escapeHtml(vis.label)} • ${dateLabel}${projTag}</div>
        </div>
        <div class="finance-tx-amount">-${formatMoney(tx.amount)}</div>
        <button class="finance-row-del" data-id="${tx.id}" data-kind="tx" title="حذف">✕</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.finance-row-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('حذف هذه المعاملة؟')) return;
      try {
        await deleteDoc(transactionDoc(btn.dataset.id));
        toast('تم حذف المعاملة', 'info', '🗑️');
      } catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
    });
  });

  // Click row body to edit
  list.querySelectorAll('.finance-tx-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.finance-row-del')) return;
      openModal('transaction', row.dataset.id);
    });
  });
}

// ── Wire toolbar buttons ─────────────────────────────────────────
(function setupFinanceControls() {
  const btnTx     = document.getElementById('btn-add-expense');
  const btnInc    = document.getElementById('btn-add-income');
  const btnBucket = document.getElementById('btn-add-bucket');
  const btnArch   = document.getElementById('fin-buckets-toggle-archived');
  if (btnTx)     btnTx    .addEventListener('click', () => openModal('transaction'));
  if (btnInc)    btnInc   .addEventListener('click', () => openModal('incomeSource'));
  if (btnBucket) btnBucket.addEventListener('click', () => openModal('bucket'));
  if (btnArch)   btnArch  .addEventListener('click', () => {
    state.financeShowArchived = !state.financeShowArchived;
    renderFinance();
  });
})();

// ── Animate counter number ──
function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const diff     = target - current;
  const steps    = 20;
  const stepVal  = diff / steps;
  let frame = 0;
  const timer = setInterval(() => {
    frame++;
    el.textContent = Math.round(current + stepVal * frame);
    if (frame >= steps) { el.textContent = target; clearInterval(timer); }
  }, 18);
}

// ════════════════════════════════════════════════════════════════
//  RENDER — CLIENTS
// ════════════════════════════════════════════════════════════════

function renderClients() {

  const q        = state.search.toLowerCase();
  
  // Sort clients: order (ascending), fallback to createdAt (descending)
  const sortedClients = [...state.clients].sort((a, b) => {
    const aOrder = a.order !== undefined ? a.order : 0;
    const bOrder = b.order !== undefined ? b.order : 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aTime = a.createdAt?.seconds || 0;
    const bTime = b.createdAt?.seconds || 0;
    return bTime - aTime; 
  });

  const filtered = q ? sortedClients.filter(c => c.name?.toLowerCase().includes(q)) : sortedClients;
  const grid     = document.getElementById('clients-grid');
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = emptyStateHTML(
      '👥',
      state.search ? 'لا نتائج مطابقة' : 'لا يوجد عملاء بعد',
      state.search ? 'جرّب كلمة بحث مختلفة' : 'اضغط "إضافة عميل" لإضافة أول عميل لك'
    );
    return;
  }

  grid.innerHTML = filtered.map(client => `
    <div class="entity-card" data-id="${client.id}" role="button" tabindex="0" draggable="true">
      <div class="card-header-row">
        <div class="card-avatar" style="background:${client.avatarUrl ? 'transparent' : escapeHtml(client.color || '#3574F0')}; overflow:hidden;">
          ${client.avatarUrl 
            ? `<img src="${client.avatarUrl}" alt="${escapeHtml(client.name)}" style="width:100%; height:100%; object-fit:cover;" />` 
            : escapeHtml(getInitials(client.name))
          }
        </div>
        <div class="card-top-actions">
          <button class="card-edit-btn" data-id="${client.id}" title="تعديل العميل">✏️</button>
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
  `).join('');

  // Events
  grid.querySelectorAll('.entity-card[data-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-del-btn') || e.target.closest('.card-edit-btn')) return;
      const client = state.clients.find(c => c.id === card.dataset.id);
      if (client) navigateTo('projects', { client });
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') card.click(); });
  });

  // Drag & Drop Events for Clients
  grid.querySelectorAll('.entity-card[data-id]').forEach(card => {
    card.addEventListener('dragstart', e => {
      state.draggedEntityId = card.dataset.id;
      state.draggedEntityType = 'client';
      card.classList.add('dragging-card');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging-card');
      state.draggedEntityId = null;
      state.draggedEntityType = null;
      grid.querySelectorAll('.entity-card').forEach(c => c.classList.remove('drag-over-card'));
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (state.draggedEntityType !== 'client' || state.draggedEntityId === card.dataset.id) return;
      card.classList.add('drag-over-card');
    });

    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over-card');
      }
    });

    card.addEventListener('drop', async e => {
      e.preventDefault();
      card.classList.remove('drag-over-card');
      if (state.draggedEntityType !== 'client' || !state.draggedEntityId || state.draggedEntityId === card.dataset.id) return;

      await handleEntityReorder('client', state.draggedEntityId, card.dataset.id);
    });
  });

  grid.querySelectorAll('.card-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal('client', btn.dataset.id);
    });
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
  const q = state.search.toLowerCase();
  
  // Sort projects: order (ascending), fallback to createdAt
  const sortedProjects = [...state.projects].sort((a, b) => {
    const aOrder = a.order !== undefined ? a.order : 0;
    const bOrder = b.order !== undefined ? b.order : 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aTime = a.createdAt?.seconds || 0;
    const bTime = b.createdAt?.seconds || 0;
    return bTime - aTime; 
  });

  const filtered = q ? sortedProjects.filter(p => p.name?.toLowerCase().includes(q)) : sortedProjects;
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = emptyStateHTML(
      '📁',
      state.search ? 'لا نتائج مطابقة' : 'لا توجد مشاريع بعد',
      state.search ? 'جرّب كلمة بحث مختلفة' : 'اضغط "مشروع جديد" لإنشاء أول مشروع'
    );
    return;
  }

  grid.innerHTML = filtered.map(project => {
    const st = PROJECT_STATUS[project.status] || PROJECT_STATUS.active;
    
    // Find client name if available
    const clientId = project._clientId || state.client?.id;
    const client = state.clients.find(c => c.id === clientId);
    const clientName = client ? client.name : '';

    // Calculate progress
    const projectTasks = state.tasks.filter(t => t._projectId === project.id);
    const doneTasks    = projectTasks.filter(t => t.status === 'done').length;
    const totalTasks   = projectTasks.length;
    const pct          = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const progressClass = pct < 30 ? 'progress-low' : pct < 75 ? 'progress-mid' : 'progress-high';

    // v22.0 — Project-card hours tag: compact "Xh Ym" mono format pulled
    // live from totalProjectHours. Shown even at 0h so the user always sees
    // the time signal on the external project card before opening it.
    const projHours = Number(project.totalProjectHours) || 0;
    const timeBadge = `<div class="project-card-hours-tag" title="إجمالي الوقت المستغرق على المشروع">⏱ ${formatHoursHm(projHours)}</div>`;

    return `
      <div class="project-compact-card" data-id="${project.id}" role="button" tabindex="0" draggable="true">
        <div class="proj-compact-header">
          <div class="proj-compact-title-wrap">
            <span class="proj-compact-icon">📁</span>
            <span class="proj-compact-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
          </div>
          <div class="proj-compact-actions">
            <span class="status-dot ${st.cls || 'status-active'}" title="${st.label}"></span>
            <button class="card-edit-btn compact" data-id="${project.id}" title="تعديل المشروع">✏️</button>
            <button class="card-del-btn compact" data-id="${project.id}" title="حذف المشروع">🗑️</button>
          </div>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          ${clientName ? `
          <div class="proj-compact-client">
            <span class="client-label">العميل:</span>
            <span class="client-val">${escapeHtml(clientName)}</span>
          </div>` : '<div></div>'}
          ${timeBadge}
        </div>

        ${project.description ? `<div class="proj-compact-desc" title="${escapeHtml(project.description)}">${escapeHtml(project.description)}</div>` : ''}

        ${Array.isArray(project.links) && project.links.length ? `
          <div class="proj-compact-links">
            ${project.links.map(l => `
              <a class="proj-link-chip" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer"
                 title="${escapeHtml(l.url)}" data-link-chip="1">
                🔗 ${escapeHtml(l.label)}
              </a>`).join('')}
          </div>` : ''}

        <div class="proj-compact-progress-wrap">
          <div class="proj-compact-progress-bar">
            <div class="progress-bar-fill ${progressClass}" style="width: ${pct}%"></div>
          </div>
          <div class="proj-compact-progress-text">
            <span style="color: ${pct < 30 ? 'var(--danger)' : pct < 75 ? '#F0A835' : '#3DB981'}; font-weight:600;">${pct}% مكتمل</span>
            <span>${doneTasks}/${totalTasks} مهام</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Click on card: navigate to tasks
  grid.querySelectorAll('.project-compact-card[data-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-del-btn') ||
          e.target.closest('.card-edit-btn') ||
          e.target.closest('[data-link-chip]')) return;
      const project = state.projects.find(p => p.id === card.dataset.id);
      if (project) {
        const clientId = project._clientId || state.client?.id;
        const client = state.clients.find(c => c.id === clientId) || state.client;
        navigateTo('tasks', { client, project, fromProjectsAll: !state.client });
      }
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') card.click(); });
  });

  // Drag & Drop Reordering Events for Projects
  grid.querySelectorAll('.project-compact-card[data-id]').forEach(card => {
    card.addEventListener('dragstart', e => {
      state.draggedEntityId = card.dataset.id;
      state.draggedEntityType = 'project';
      card.classList.add('dragging-card');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging-card');
      state.draggedEntityId = null;
      state.draggedEntityType = null;
      grid.querySelectorAll('.project-compact-card').forEach(c => c.classList.remove('drag-over-card'));
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (state.draggedEntityType !== 'project' || state.draggedEntityId === card.dataset.id) return;
      card.classList.add('drag-over-card');
    });

    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over-card');
      }
    });

    card.addEventListener('drop', async e => {
      e.preventDefault();
      card.classList.remove('drag-over-card');
      if (state.draggedEntityType !== 'project' || !state.draggedEntityId || state.draggedEntityId === card.dataset.id) return;

      const draggedProject = state.projects.find(p => p.id === state.draggedEntityId);
      const targetProject  = state.projects.find(p => p.id === card.dataset.id);
      const draggedClientId = draggedProject?._clientId || state.client?.id;
      const targetClientId  = targetProject?._clientId  || state.client?.id;
      if (!draggedClientId || !targetClientId) return;
      // Prevent cross-client reorder in "all projects" mode — would move docs to wrong client.
      if (draggedClientId !== targetClientId) {
        toast('لا يمكن إعادة ترتيب مشاريع عملاء مختلفين', 'error');
        return;
      }

      await handleEntityReorder('project', state.draggedEntityId, card.dataset.id, draggedClientId);
    });
  });

  // Edit / Delete click handlers — openModal() captures project._clientId
  // into state.editTarget.clientId, so no need to mutate state.client here.
  grid.querySelectorAll('.card-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal('project', btn.dataset.id);
    });
  });

  grid.querySelectorAll('.card-del-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const project = state.projects.find(p => p.id === btn.dataset.id);
      const clientId = project?._clientId || state.client?.id;
      openConfirm({
        type:    'project',
        id:      btn.dataset.id,
        name:    project?.name,
        warning: 'سيتم حذف جميع مهام هذا المشروع أيضاً',
        clientId: clientId
      });
    });
  });
}

// ════════════════════════════════════════════════════════════════
//  RENDER — KANBAN (Tasks)
// ════════════════════════════════════════════════════════════════

// v19.5 — Linear gauge of project effort (totalProjectHours) shown next to
// the "add task" button on the Kanban toolbar. Fill width is normalised
// against a soft 100h ceiling; past that the bar caps but the label keeps
// counting the real total.
function renderProjectHoursGauge() {
  const wrap  = document.getElementById('project-hours-gauge');
  const fill  = document.getElementById('project-hours-gauge-fill');
  const label = document.getElementById('project-hours-gauge-label');
  if (!wrap || !fill || !label) return;

  // Prefer the live snapshot from state.allProjects (richer) — fall back to state.project.
  const live = state.allProjects.find(p => p.id === state.project?.id);
  const hours = Number((live || state.project)?.totalProjectHours) || 0;

  const CAP = 100;   // visual normalisation ceiling
  const pct = Math.min(100, (hours / CAP) * 100);
  fill.style.width = pct + '%';
  label.textContent = `إجمالي الوقت المستغرق: ${formatHours(hours)}`;
}

function renderKanban() {
  // v19.5 — gauge is part of the Kanban toolbar; refresh on every render
  // so it tracks live totalProjectHours updates from saveFocusHours().
  renderProjectHoursGauge();

  const q        = state.search.toLowerCase();
  const filtered = q
    ? state.tasks.filter(t => t.title?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))
    : state.tasks;

  const groups = { todo: [], doing: [], done: [] };
  filtered.forEach(t => { if (groups[t.status]) groups[t.status].push(t); });

  // v16.0 — Order tasks within each column by orderIndex (ascending),
  // falling back to createdAt (newest first) when not yet set.
  const sortInColumn = (a, b) => {
    const ai = (typeof a.orderIndex === 'number') ? a.orderIndex : Number.POSITIVE_INFINITY;
    const bi = (typeof b.orderIndex === 'number') ? b.orderIndex : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    const at = a.createdAt?.seconds || 0;
    const bt = b.createdAt?.seconds || 0;
    return bt - at;
  };
  groups.todo.sort(sortInColumn);
  groups.doing.sort(sortInColumn);
  groups.done.sort(sortInColumn);

  // Counters
  const ct = document.getElementById('count-todo');
  const cd = document.getElementById('count-doing');
  const cn = document.getElementById('count-done');
  if (ct) ct.textContent = groups.todo.length;
  if (cd) cd.textContent = groups.doing.length;
  if (cn) cn.textContent = groups.done.length;
  // Stats in header
  const st = document.getElementById('stat-todo');
  const sd = document.getElementById('stat-doing');
  const sn = document.getElementById('stat-done');
  if (st) st.textContent  = groups.todo.length;
  if (sd) sd.textContent  = groups.doing.length;
  if (sn) sn.textContent  = groups.done.length;

  [
    { el: document.getElementById('col-todo'),  tasks: groups.todo,  emptyIcon: '📋', emptyText: 'لا توجد مهام\nاضغط + لإضافة مهمة', isTodo: true },
    { el: document.getElementById('col-doing'), tasks: groups.doing, emptyIcon: '⏳', emptyText: 'اسحب مهمة هنا\nلبدء العمل عليها', isTodo: false },
    { el: document.getElementById('col-done'),  tasks: groups.done,  emptyIcon: '✅', emptyText: 'المهام المنجزة\nستظهر هنا', isTodo: false },
  ].forEach(({ el, tasks, emptyIcon, emptyText, isTodo }) => {
    if (!el) return;

    // For the todo column: save and restore the quick-add form
    let savedQuickAdd = null;
    if (isTodo) {
      savedQuickAdd = el.querySelector('.quick-add-task');
      if (savedQuickAdd) el.removeChild(savedQuickAdd);
    }

    el.innerHTML = tasks.length === 0
      ? `<div class="col-empty"><div class="empty-icon">${emptyIcon}</div><div style="text-align:center;line-height:1.9;white-space:pre-line">${emptyText}</div></div>`
      : tasks.map(taskCardHTML).join('');

    // Re-prepend the quick-add form at the top
    if (isTodo && savedQuickAdd) {
      el.insertBefore(savedQuickAdd, el.firstChild);
    }

    bindTaskCardEvents(el);
  });
}

function taskCardHTML(task) {
  // v19.0 — Per-task hours dropped; tracking lives on the project doc now.

  // Inline thumbnail with hard corners — clicking opens a full-size lightbox.
  const imgBlock = task.imageUrl
    ? `<img class="task-card-thumb" src="${task.imageUrl}" alt="" data-img="${task.imageUrl}" title="عرض الصورة" />`
    : '';

  return `
    <div class="task-card" id="tc-${task.id}" draggable="true" data-id="${task.id}">
      <div class="card-top" style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div class="card-title">${escapeHtml(task.title)}</div>
        <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
          <button class="card-edit-btn" data-id="${task.id}" title="تعديل المهمة">✏️</button>
          <button class="card-menu-btn" data-id="${task.id}" title="حذف المهمة">✕</button>
        </div>
      </div>
      ${task.notes ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;line-height:1.55">${escapeHtml(task.notes)}</div>` : ''}
      ${imgBlock}
      <div class="card-footer" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
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

  colEl.querySelectorAll('.card-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal('task', btn.dataset.id);
    });
  });

  colEl.querySelectorAll('.task-card-thumb').forEach(img => {
    img.addEventListener('click', e => {
      e.stopPropagation();
      openImageLightbox(img.dataset.img);
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
// v16.0 — Supports both cross-column status changes AND intra-column
// vertical reordering. Drop position is computed from the cursor's Y
// relative to other cards inside the same column body.

// Returns the card element BEFORE which the dragged card should land
// (or null to append at the end), based on cursor Y position.
function getKanbanDropTarget(colBody, y, draggedId) {
  const cards = [...colBody.querySelectorAll('.task-card')]
    .filter(c => c.dataset.id !== draggedId);
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (y < r.top + r.height / 2) return card;
  }
  return null;
}

function setupColumnDnD() {
  document.querySelectorAll('#kanban .column').forEach(col => {
    const status = col.dataset.status;
    const body   = col.querySelector('.col-body');

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
      if (!state.draggedId || !state.client || !state.project || !body) return;

      const task = state.tasks.find(t => t.id === state.draggedId);
      if (!task) return;

      const labels = { todo: 'المطلوب', doing: 'جاري التنفيذ', done: 'تم الإنتهاء' };
      const isStatusChange = task.status !== status;

      // 1. Build the desired post-drop order of task IDs in THIS column.
      const beforeCard = getKanbanDropTarget(body, e.clientY, state.draggedId);
      const colTaskIds = [...body.querySelectorAll('.task-card')]
        .map(c => c.dataset.id)
        .filter(id => id !== state.draggedId);
      const insertIdx = beforeCard ? colTaskIds.indexOf(beforeCard.dataset.id) : colTaskIds.length;
      colTaskIds.splice(insertIdx < 0 ? colTaskIds.length : insertIdx, 0, state.draggedId);

      // 2. Persist new orderIndex for every card in the column + status flip.
      try {
        const batch = writeBatch(db);
        colTaskIds.forEach((tid, i) => {
          const update = { orderIndex: i };
          if (tid === state.draggedId && isStatusChange) update.status = status;
          batch.update(taskDoc(state.client.id, state.project.id, tid), update);
        });
        await batch.commit();

        if (isStatusChange) {
          toast(`تم نقل المهمة إلى "${labels[status]}"`, 'success');
        }
      } catch (err) {
        toast('فشل تحديث الترتيب', 'error');
        console.error(err);
      }
    });
  });
}

// ── Drag & Drop Reordering for Clients & Projects ──────────────────
async function handleEntityReorder(type, draggedId, targetId, scopeClientId = null) {
  let list;
  if (type === 'client') {
    list = state.clients;
  } else {
    // For projects, only reorder within the same client to keep ordering meaningful
    const cId = scopeClientId || state.client?.id;
    if (!cId) return;
    list = state.projects.filter(p => (p._clientId || state.client?.id) === cId);
  }

  const sorted = [...list].sort((a, b) => {
    const aOrder = a.order !== undefined ? a.order : 0;
    const bOrder = b.order !== undefined ? b.order : 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aTime = a.createdAt?.seconds || 0;
    const bTime = b.createdAt?.seconds || 0;
    return bTime - aTime;
  });

  const draggedIdx = sorted.findIndex(item => item.id === draggedId);
  const targetIdx = sorted.findIndex(item => item.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return;

  const [removed] = sorted.splice(draggedIdx, 1);
  sorted.splice(targetIdx, 0, removed);

  const batch = writeBatch(db);
  sorted.forEach((item, idx) => {
    const docRef = type === 'client'
      ? clientDoc(item.id)
      : projectDoc(item._clientId || scopeClientId || state.client.id, item.id);
    batch.update(docRef, { order: idx });
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error(err);
    toast('فشل حفظ الترتيب الجديد', 'error');
  }
}

// ════════════════════════════════════════════════════════════════
//  HEADER & BREADCRUMB
// ════════════════════════════════════════════════════════════════

function updateHeader() {
  const titleEl   = document.getElementById('page-title');
  const actionsEl = document.getElementById('header-actions');
  const statsEl   = document.getElementById('header-stats');
  if (!titleEl || !actionsEl || !statsEl) return;

  if (state.view === 'dashboard') {
    titleEl.textContent  = '📊 الرئيسية';
    statsEl.innerHTML    = '';
    actionsEl.innerHTML  = '';

  } else if (state.view === 'focus') {
    titleEl.textContent  = '⏱️ جلسة التركيز';
    statsEl.innerHTML    = '';
    actionsEl.innerHTML  = '';

  } else if (state.view === 'clients') {
    titleEl.textContent  = '👥 العملاء';
    statsEl.innerHTML    = '';
    actionsEl.innerHTML  = '';

  } else if (state.view === 'projects') {
    titleEl.textContent  = state.client ? `📁 ${escapeHtml(state.client.name)}` : '📁 كافة المشاريع';
    statsEl.innerHTML    = '';
    actionsEl.innerHTML  = '';

  } else if (state.view === 'tasks') {
    titleEl.textContent = `📋 ${escapeHtml(state.project?.name || '')}`;
    statsEl.innerHTML   = `
      <div class="stat-pill"><span class="dot todo"></span><span id="stat-todo">0</span></div>
      <div class="stat-pill"><span class="dot doing"></span><span id="stat-doing">0</span></div>
      <div class="stat-pill"><span class="dot done"></span><span id="stat-done">0</span></div>`;
    actionsEl.innerHTML = '';
    renderKanban();

  } else if (state.view === 'calendar') {
    titleEl.textContent = '📅 تقويم المهام';
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';

  } else if (state.view === 'day') {
    titleEl.textContent = '📅 تفاصيل اليوم';
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';

  } else if (state.view === 'finance') {
    titleEl.textContent = '💰 المركز المالي';
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';
  }
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  if (state.view === 'dashboard' || state.view === 'focus' || state.view === 'clients' || (state.view === 'projects' && !state.client)) {
    bc.innerHTML = '';
    return;
  }

  let html = `<span class="breadcrumb-link" data-to="dashboard">📊 الرئيسية</span>`;

  if (state.view === 'projects' && state.client) {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="clients">العملاء</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">${escapeHtml(state.client.name)}</span>`;
  }

  if (state.view === 'tasks') {
    html += `<span class="breadcrumb-sep">›</span>`;
    if (state.navigationSource === 'dashboard') {
      html += `<span class="breadcrumb-current">${escapeHtml(state.project?.name)}</span>`;
    } else if (state.navigationSource === 'projects-all') {
      html += `<span class="breadcrumb-link" data-to="projects">المشاريع</span>
               <span class="breadcrumb-sep">›</span>
               <span class="breadcrumb-current">${escapeHtml(state.project?.name)}</span>`;
    } else {
      html += `<span class="breadcrumb-link" data-to="clients">العملاء</span>
               <span class="breadcrumb-sep">›</span>
               <span class="breadcrumb-link" data-to="projects" data-client="true">${escapeHtml(state.client?.name)}</span>
               <span class="breadcrumb-sep">›</span>
               <span class="breadcrumb-current">${escapeHtml(state.project?.name)}</span>`;
    }
  }

  bc.innerHTML = html;

  bc.querySelectorAll('[data-to]').forEach(el => {
    el.addEventListener('click', () => {
      const to = el.dataset.to;
      if (to === 'dashboard') {
        navigateTo('dashboard');
      } else if (to === 'clients') {
        navigateTo('clients');
      } else if (to === 'projects') {
        if (el.dataset.client) {
          navigateTo('projects', { client: state.client });
        } else {
          navigateTo('projects');
        }
      }
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
      </div>
      <div class="form-group">
        <label class="form-label">شعار أو صورة العميل (اختياري)</label>
        <input type="file" id="f-avatar" class="form-input" accept="image/*" />
      </div>`,
  },
  project: {
    title:      '📁 إضافة مشروع جديد',
    submitText: 'إضافة المشروع',
    fields: `
      <div class="form-group" id="project-client-group" style="display:none;">
        <label class="form-label">العميل <span class="required">*</span></label>
        <select id="f-client-id" class="form-select">
          <!-- populated dynamically -->
        </select>
      </div>
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
      </div>
      <!-- v26.0 — Flexible pricing: hourly OR fixed (or both, hourly wins).
           At save time exactly one becomes pricingType. -->
      <div class="form-group">
        <label class="form-label">التسعير (املأ واحد على الأقل لتفعيل الحسابات المالية)</label>
        <div class="pricing-row">
          <div class="pricing-field" data-kind="hourly">
            <label class="pricing-sub-label">💵 سعر الساعة</label>
            <input type="number" id="f-hourly-rate" class="form-input pricing-input"
              step="0.01" min="0" placeholder="0" />
          </div>
          <div class="pricing-field" data-kind="fixed">
            <label class="pricing-sub-label">📦 السعر الإجمالي الثابت</label>
            <input type="number" id="f-fixed-price" class="form-input pricing-input"
              step="0.01" min="0" placeholder="0" />
          </div>
        </div>
        <small class="pricing-hint">
          الحقل الممتلئ هو الـ <code>pricingType</code> النشط للحسابات. لو الاتنين فاضيين، المشروع شخصي.
        </small>
      </div>
      <div class="form-group">
        <label class="form-label">روابط سريعة (اختياري)</label>
        <div id="proj-links-list" class="proj-links-list">
          <!-- Dynamic Label/URL rows injected by JS -->
        </div>
        <button type="button" id="proj-links-add" class="btn-ghost proj-links-add-btn">
          ＋ إضافة رابط
        </button>
      </div>`,
  },
  bucket: {
    title:      '🗂️ إضافة وعاء صرف',
    submitText: 'إنشاء الوعاء',
    fields: `
      <div class="form-group">
        <label class="form-label">اسم الوعاء <span class="required">*</span></label>
        <input type="text" id="f-bkt-name" class="form-input"
          placeholder="مثال: تجهيزات الفرح" maxlength="60" required />
      </div>
      <div class="form-group">
        <label class="form-label">الميزانية المرصودة (اختياري)</label>
        <input type="number" id="f-bkt-target" class="form-input" step="0.01" min="0"
          placeholder="اتركها فاضي لو الوعاء بدون سقف" />
      </div>
      <div class="form-group">
        <label class="form-label">أيقونة (اختياري)</label>
        <input type="text" id="f-bkt-icon" class="form-input"
          placeholder="🎯  أو أي إيموجي" maxlength="4" />
      </div>
      <div class="form-group">
        <label class="form-label">الحالة</label>
        <select id="f-bkt-status" class="form-select">
          <option value="active">🟢 نشط</option>
          <option value="archived">🗄️ مؤرشف</option>
        </select>
      </div>`,
  },
  transaction: {
    title:      '💸 تسجيل مصروف',
    submitText: 'تسجيل المصروف',
    fields: `
      <div class="form-group">
        <label class="form-label">بيان المصروف <span class="required">*</span></label>
        <input type="text" id="f-tx-title" class="form-input"
          placeholder="مثال: دفعة حجز القاعة" maxlength="100" required />
      </div>
      <div class="form-group" style="display:flex; gap:10px;">
        <div style="flex:1;">
          <label class="form-label">المبلغ <span class="required">*</span></label>
          <input type="number" id="f-tx-amount" class="form-input" step="0.01" min="0"
            placeholder="0" required />
        </div>
        <div style="flex:1;">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input type="date" id="f-tx-date" class="form-input" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">الوعاء (يقرأ النشطة فقط) <span class="required">*</span></label>
        <select id="f-tx-bucket" class="form-select" required>
          <!-- populated dynamically from active buckets -->
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">مشروع مرتبط (اختياري — لو ميزانية مشروع)</label>
        <select id="f-tx-project" class="form-select">
          <!-- populated dynamically -->
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">ملاحظات (اختياري)</label>
        <textarea id="f-tx-notes" class="form-textarea"
          placeholder="تفاصيل إضافية..." maxlength="240"></textarea>
      </div>`,
  },
  incomeSource: {
    title:      '💼 إضافة مصدر دخل',
    submitText: 'إضافة المصدر',
    fields: `
      <div class="form-group">
        <label class="form-label">نوع المصدر <span class="required">*</span></label>
        <select id="f-inc-type" class="form-select" required>
          <option value="salary">🏢 راتب شهري ثابت</option>
          <option value="freelance">💻 مشروع حر (ساعات × سعر)</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">التسمية <span class="required">*</span></label>
        <input type="text" id="f-inc-label" class="form-input"
          placeholder="مثال: شركة النور — راتب أساسي" maxlength="80" required />
      </div>
      <div class="form-group" id="inc-salary-group">
        <label class="form-label">الراتب الشهري <span class="required">*</span></label>
        <input type="number" id="f-inc-monthly" class="form-input" step="0.01" min="0"
          placeholder="0" />
      </div>
      <div class="form-group" id="inc-freelance-group" style="display:none;">
        <label class="form-label">المشروع <span class="required">*</span></label>
        <select id="f-inc-project" class="form-select">
          <!-- populated dynamically -->
        </select>
        <label class="form-label" style="margin-top:10px;">سعر الساعة <span class="required">*</span></label>
        <input type="number" id="f-inc-rate" class="form-input" step="0.01" min="0"
          placeholder="0" />
        <small style="display:block; margin-top:6px; color:var(--text-muted); font-size:11px;">
          الإيراد المحسوب = سعر الساعة × إجمالي ساعات المشروع (totalProjectHours) لحظياً.
        </small>
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
      <div class="form-group" style="display:flex; gap:10px;">
        <div style="flex:1;">
          <label class="form-label">تاريخ البدء <span class="required">*</span></label>
          <input type="date" id="f-start-date" class="form-input" required />
        </div>
        <div style="flex:1;">
          <label class="form-label">تاريخ الانتهاء (اختياري)</label>
          <input type="date" id="f-end-date" class="form-input" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">ملاحظات (اختياري)</label>
        <textarea id="f-notes" class="form-textarea"
          placeholder="تفاصيل إضافية عن المهمة..." maxlength="300"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">صورة مرفقة (اختياري)</label>
        <input type="file" id="f-task-image" class="form-input" accept="image/*" />
        <div id="f-task-image-current" class="task-img-current hidden"></div>
      </div>`,
  },
};

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// ── Project Quick Links UI helpers (v16.0) ──
function projLinkRowHTML(label = '', url = '') {
  return `
    <div class="proj-link-row">
      <input type="text" class="form-input proj-link-label" placeholder="عنوان الرابط (مثال: فيجما)"
        maxlength="40" value="${escapeHtml(label)}" />
      <input type="url" class="form-input proj-link-url" placeholder="https://..."
        maxlength="500" value="${escapeHtml(url)}" />
      <button type="button" class="proj-link-remove" title="حذف الرابط" aria-label="حذف">✕</button>
    </div>`;
}

function bindProjectLinksControls() {
  const list   = document.getElementById('proj-links-list');
  const addBtn = document.getElementById('proj-links-add');
  if (!list || !addBtn) return;

  addBtn.addEventListener('click', () => {
    list.insertAdjacentHTML('beforeend', projLinkRowHTML());
  });

  list.addEventListener('click', (e) => {
    const rm = e.target.closest('.proj-link-remove');
    if (!rm) return;
    rm.closest('.proj-link-row')?.remove();
  });
}

// v26.0 — Highlight the pricing field that's actually carrying a value, so
// the user gets visual confirmation which path the maths will take.
function bindPricingActiveGlow() {
  const rateEl  = document.getElementById('f-hourly-rate');
  const priceEl = document.getElementById('f-fixed-price');
  if (!rateEl || !priceEl) return;
  const sync = () => {
    const rateOn  = rateEl.value.trim()  !== '' && Number(rateEl.value)  > 0;
    const priceOn = priceEl.value.trim() !== '' && Number(priceEl.value) > 0;
    rateEl.closest('.pricing-field') ?.classList.toggle('is-active', rateOn);
    priceEl.closest('.pricing-field')?.classList.toggle('is-active', priceOn);
  };
  rateEl.addEventListener('input', sync);
  priceEl.addEventListener('input', sync);
  sync();
}

// Collect non-empty {label, url} pairs from the modal. URL is required;
// label falls back to the URL's hostname.
function collectProjectLinks() {
  const rows = document.querySelectorAll('#proj-links-list .proj-link-row');
  const out = [];
  rows.forEach(row => {
    const url = row.querySelector('.proj-link-url')?.value.trim();
    if (!url) return;
    let label = row.querySelector('.proj-link-label')?.value.trim();
    if (!label) {
      try { label = new URL(url).hostname.replace(/^www\./, ''); }
      catch { label = url; }
    }
    out.push({ label, url });
  });
  return out;
}

function openModal(type, editId = null) {
  currentModalType = type;
  state.editTarget = editId ? { type, id: editId } : null;
  
  if (type === 'project' && editId) {
    const project = state.projects.find(p => p.id === editId);
    state.editTarget.clientId = project?._clientId;
  }
  
  const cfg = MODAL_CONFIGS[type];
  document.getElementById('modal-title').textContent   = state.editTarget ? cfg.title.replace('إضافة', 'تعديل') : cfg.title;
  document.getElementById('modal-body').innerHTML      = cfg.fields;
  document.getElementById('modal-submit-btn').textContent = state.editTarget ? cfg.submitText.replace('إضافة', 'تعديل') : cfg.submitText;
  
  if (type === 'project') {
    const cg = document.getElementById('project-client-group');
    if (cg) {
      if (!state.client && !state.editTarget) {
        cg.style.display = 'flex';
        const sel = document.getElementById('f-client-id');
        if (sel) {
          sel.innerHTML = state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        }
      } else {
        cg.style.display = 'none';
      }
    }
    bindProjectLinksControls();
    bindPricingActiveGlow();
  }

  if (type === 'task' && !state.editTarget) {
    // Default startDate to today (LOCAL — not UTC, fixes day-1 bug)
    const sd = document.getElementById('f-start-date');
    if (sd) sd.value = toLocalISODate(new Date());
  }

  if (type === 'transaction') {
    if (!state.editTarget) {
      const d = document.getElementById('f-tx-date');
      if (d) d.value = toLocalISODate(new Date());
    }
    // Active buckets only — archived hidden by design
    const bSel = document.getElementById('f-tx-bucket');
    if (bSel) {
      const active = state.buckets.filter(b => b.status !== 'archived');
      if (active.length === 0) {
        bSel.innerHTML = `<option value="">⚠️ لا يوجد أوعية نشطة — أنشئ وعاء أولاً</option>`;
      } else {
        bSel.innerHTML = active.map(b => {
          const vis = bucketVisual(b);
          return `<option value="${b.id}">${vis.icon} ${escapeHtml(vis.label)}</option>`;
        }).join('');
      }
    }
    // Optional project link
    const pSel = document.getElementById('f-tx-project');
    if (pSel) {
      pSel.innerHTML = `<option value="">— بدون ربط —</option>` +
        state.allProjects.map(p => {
          const c = state.clients.find(cl => cl.id === p._clientId);
          const label = c ? `${p.name} — ${c.name}` : p.name;
          return `<option value="${p.id}">${escapeHtml(label)}</option>`;
        }).join('');
    }
  }

  if (type === 'incomeSource') {
    // Populate project dropdown and wire type toggle
    const sel = document.getElementById('f-inc-project');
    if (sel) {
      sel.innerHTML = state.allProjects.map(p => {
        const c = state.clients.find(cl => cl.id === p._clientId);
        const label = c ? `${p.name} — ${c.name}` : p.name;
        return `<option value="${p.id}">${escapeHtml(label)}</option>`;
      }).join('');
    }
    const typeSel = document.getElementById('f-inc-type');
    const sg = document.getElementById('inc-salary-group');
    const fg = document.getElementById('inc-freelance-group');
    const toggle = () => {
      const isSalary = typeSel.value === 'salary';
      if (sg) sg.style.display = isSalary ? '' : 'none';
      if (fg) fg.style.display = isSalary ? 'none' : '';
      const monthly = document.getElementById('f-inc-monthly');
      const rate    = document.getElementById('f-inc-rate');
      if (monthly) monthly.required = isSalary;
      if (rate)    rate.required    = !isSalary;
    };
    if (typeSel) {
      typeSel.addEventListener('change', toggle);
      toggle();
    }
  }

  if (state.editTarget) {
    prefillModalValues();
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.querySelector('#modal-body input, #modal-body textarea')?.focus(), 60);
}

function prefillModalValues() {
  const { type, id } = state.editTarget;
  
  if (type === 'client') {
    const client = state.clients.find(c => c.id === id);
    if (!client) return;
    document.getElementById('f-name').value = client.name || '';
    const descEl = document.getElementById('f-desc');
    if (descEl) descEl.value = client.description || '';
    
    if (client.avatarUrl) {
      const parent = document.getElementById('f-avatar').parentElement;
      const preview = document.createElement('div');
      preview.style.marginTop = '8px';
      preview.style.display = 'flex';
      preview.style.alignItems = 'center';
      preview.style.gap = '8px';
      preview.innerHTML = `
        <img src="${client.avatarUrl}" style="width:36px; height:36px; border-radius:50%; object-fit:cover;" />
        <span style="font-size:12px; color:var(--text-muted);">الشعار الحالي</span>
      `;
      parent.appendChild(preview);
    }
    
  } else if (type === 'project') {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;
    document.getElementById('f-name').value = project.name || '';
    const descEl = document.getElementById('f-desc');
    if (descEl) descEl.value = project.description || '';
    const statusEl = document.getElementById('f-status');
    if (statusEl) statusEl.value = project.status || 'active';

    // v26.0 — Pricing prefill (both fields surface; pricingType is inferred at save)
    const rateEl  = document.getElementById('f-hourly-rate');
    const priceEl = document.getElementById('f-fixed-price');
    if (rateEl)  rateEl.value  = project.hourlyRate        ?? '';
    if (priceEl) priceEl.value = project.projectFixedPrice ?? '';
    bindPricingActiveGlow();   // re-evaluate the glow state after prefill

    // Prefill quick links
    const linksList = document.getElementById('proj-links-list');
    if (linksList && Array.isArray(project.links)) {
      linksList.innerHTML = project.links.map(l => projLinkRowHTML(l.label, l.url)).join('');
    }

  } else if (type === 'bucket') {
    const b = state.buckets.find(x => x.id === id);
    if (!b) return;
    document.getElementById('f-bkt-name').value   = b.bucketName  || '';
    document.getElementById('f-bkt-target').value = b.targetBudget ?? '';
    document.getElementById('f-bkt-icon').value   = b.icon || '';
    document.getElementById('f-bkt-status').value = b.status || 'active';

  } else if (type === 'transaction') {
    const tx = state.transactions.find(x => x.id === id);
    if (!tx) return;
    document.getElementById('f-tx-title').value  = tx.title  || '';
    document.getElementById('f-tx-amount').value = tx.amount ?? '';
    const date = parseDateField(tx.date);
    document.getElementById('f-tx-date').value   = toLocalISODate(date || new Date());
    const bSel = document.getElementById('f-tx-bucket');
    // If the linked bucket is archived, surface it in the dropdown so the
    // user can still see it during edit (otherwise the option would be missing).
    if (bSel && tx.bucketId) {
      const exists = [...bSel.options].some(o => o.value === tx.bucketId);
      if (!exists) {
        const b = state.buckets.find(x => x.id === tx.bucketId);
        const vis = bucketVisual(b);
        const opt = document.createElement('option');
        opt.value = tx.bucketId;
        opt.textContent = `${vis.icon} ${vis.label} (مؤرشف)`;
        bSel.appendChild(opt);
      }
      bSel.value = tx.bucketId;
    }
    const pSel = document.getElementById('f-tx-project');
    if (pSel) pSel.value = tx.projectId || '';
    const nEl = document.getElementById('f-tx-notes');
    if (nEl) nEl.value = tx.notes || '';

  } else if (type === 'incomeSource') {
    const src = state.incomeSources.find(s => s.id === id);
    if (!src) return;
    const typeSel = document.getElementById('f-inc-type');
    if (typeSel) {
      typeSel.value = src.type || 'salary';
      typeSel.dispatchEvent(new Event('change'));
    }
    document.getElementById('f-inc-label').value = src.label || '';
    if (src.type === 'salary') {
      document.getElementById('f-inc-monthly').value = src.monthlyAmount ?? '';
    } else {
      const projSel = document.getElementById('f-inc-project');
      if (projSel && src.projectId) projSel.value = src.projectId;
      document.getElementById('f-inc-rate').value = src.hourlyRate ?? '';
    }

  } else if (type === 'task') {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    document.getElementById('f-title').value = task.title || '';
    const priorityEl = document.getElementById('f-priority');
    if (priorityEl) priorityEl.value = task.priority || '';
    const notesEl = document.getElementById('f-notes');
    if (notesEl) notesEl.value = task.notes || '';
    const sdEl = document.getElementById('f-start-date');
    const edEl = document.getElementById('f-end-date');
    const sd = parseDateField(task.startDate);
    const ed = parseDateField(task.endDate);
    if (sdEl) sdEl.value = toLocalISODate(sd || new Date());
    if (edEl) edEl.value = ed ? toLocalISODate(ed) : '';

    // Show current task image preview if one exists
    if (task.imageUrl) {
      const cur = document.getElementById('f-task-image-current');
      if (cur) {
        cur.classList.remove('hidden');
        cur.innerHTML = `
          <img src="${task.imageUrl}" alt="" />
          <span>الصورة الحالية — ارفع صورة جديدة لاستبدالها</span>`;
      }
    }
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-form').reset();
  document.getElementById('modal-body').innerHTML = '';
  currentModalType = null;
  state.editTarget = null;
}

document.getElementById('close-modal-btn')?.addEventListener('click',  closeModal);
document.getElementById('cancel-modal-btn')?.addEventListener('click', closeModal);
document.getElementById('modal-overlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ── Modal Submit ────────────────────────────────────────────────
document.getElementById('modal-form')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn  = document.getElementById('modal-submit-btn');
  const orig = btn.textContent;
  btn.disabled    = true;
  btn.textContent = state.editTarget ? 'جاري التعديل...' : 'جاري الإضافة...';

  try {
    if (currentModalType === 'client') {
      const name = document.getElementById('f-name').value.trim();
      const desc = document.getElementById('f-desc')?.value.trim();
      if (!name) { toast('يرجى إدخال اسم العميل', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      const fileInput = document.getElementById('f-avatar');
      let avatarData = null;
      if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        // Firestore document size limit is ~1MB. Base64 inflates payload by ~33%,
        // so cap the raw file at 700KB to keep the encoded URL safely under the limit.
        if (file.size > 700 * 1024) {
          toast('حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 700 كيلوبايت', 'error');
          btn.disabled = false;
          btn.textContent = orig;
          return;
        }
        avatarData = await readAsDataURL(file);
        // Final safety check on encoded size (in case of unusual encodings)
        if (avatarData.length > 950 * 1024) {
          toast('الصورة بعد المعالجة كبيرة جداً، اختر صورة أصغر', 'error');
          btn.disabled = false;
          btn.textContent = orig;
          return;
        }
      }

      if (state.editTarget) {
        const updateData = { name, description: desc || null };
        if (avatarData) updateData.avatarUrl = avatarData;
        await updateDoc(clientDoc(state.editTarget.id), updateData);
        toast('تم تعديل العميل بنجاح! 🎉', 'success');
      } else {
        await addDoc(clientsRef(), { 
          name, 
          description: desc || null, 
          color: randomColor(), 
          avatarUrl: avatarData || null,
          createdAt: serverTimestamp() 
        });
        toast('تمت إضافة العميل! 🎉', 'success');
      }
      closeModal();

    } else if (currentModalType === 'project') {
      const name   = document.getElementById('f-name').value.trim();
      const desc   = document.getElementById('f-desc')?.value.trim();
      const status = document.getElementById('f-status')?.value || 'active';
      if (!name) { toast('يرجى إدخال اسم المشروع', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      const cId = state.client?.id || (state.editTarget && state.editTarget.clientId) || document.getElementById('f-client-id')?.value;
      if (!cId) { toast('يرجى تحديد العميل أولاً', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      // v26.0 — Flexible pricing. Both inputs are optional visually, but if
      // both are empty we treat this as a personal/unpaid project.
      const rateRaw  = document.getElementById('f-hourly-rate')?.value;
      const priceRaw = document.getElementById('f-fixed-price')?.value;
      const hourlyRate        = rateRaw  !== '' && rateRaw  != null ? Number(rateRaw)  : null;
      const projectFixedPrice = priceRaw !== '' && priceRaw != null ? Number(priceRaw) : null;
      if (hourlyRate != null && !(hourlyRate > 0)) {
        toast('سعر الساعة لازم يكون أكبر من صفر', 'error');
        btn.disabled = false; btn.textContent = orig; return;
      }
      if (projectFixedPrice != null && !(projectFixedPrice > 0)) {
        toast('السعر الإجمالي لازم يكون أكبر من صفر', 'error');
        btn.disabled = false; btn.textContent = orig; return;
      }
      // Infer pricingType: hourly wins when both filled; null when neither.
      let pricingType = null;
      if (hourlyRate != null)        pricingType = 'hourly';
      else if (projectFixedPrice != null) pricingType = 'fixed';

      const links = collectProjectLinks();

      const payload = {
        name, description: desc || null, status, links,
        hourlyRate, projectFixedPrice, pricingType,
      };

      if (state.editTarget) {
        await updateDoc(projectDoc(cId, state.editTarget.id), payload);
        toast('تم تعديل المشروع بنجاح! 🎉', 'success');
      } else {
        await addDoc(projectsRef(cId), { ...payload, createdAt: serverTimestamp() });
        toast('تمت إضافة المشروع! 🎉', 'success');
      }
      closeModal();

    } else if (currentModalType === 'task') {
      const title    = document.getElementById('f-title').value.trim();
      const priority = document.getElementById('f-priority')?.value || null;
      const notes    = document.getElementById('f-notes')?.value.trim() || null;
      const sdStr    = document.getElementById('f-start-date')?.value;
      const edStr    = document.getElementById('f-end-date')?.value;
      if (!title) { toast('يرجى إدخال عنوان المهمة', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!sdStr) { toast('يرجى تحديد تاريخ البدء', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      // Build at LOCAL midnight so the calendar day matches what the user picked.
      const startDate = fromLocalISODate(sdStr);
      const endDate   = edStr ? fromLocalISODate(edStr) : null;
      if (endDate && endDate < startDate) {
        toast('تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء', 'error');
        btn.disabled = false; btn.textContent = orig; return;
      }

      // Optional attached image — stored as base64 to match the client-avatar pattern
      // (avoids extra Firebase Storage setup; keep small to respect Firestore's 1 MB doc limit).
      const imgInput = document.getElementById('f-task-image');
      let imageData;   // undefined = leave unchanged, null = remove, string = new
      if (imgInput && imgInput.files && imgInput.files[0]) {
        const file = imgInput.files[0];
        if (file.size > 700 * 1024) {
          toast('حجم الصورة كبير جداً، اختر صورة أقل من 700 كيلوبايت', 'error');
          btn.disabled = false; btn.textContent = orig; return;
        }
        imageData = await readAsDataURL(file);
        if (imageData.length > 950 * 1024) {
          toast('الصورة بعد المعالجة كبيرة جداً، اختر صورة أصغر', 'error');
          btn.disabled = false; btn.textContent = orig; return;
        }
      }

      if (state.editTarget) {
        const updateData = { title, priority, notes, startDate, endDate };
        if (imageData !== undefined) updateData.imageUrl = imageData;
        await updateDoc(taskDoc(state.client.id, state.project.id, state.editTarget.id), updateData);
        toast('تم تعديل المهمة بنجاح! 🎉', 'success');
      } else {
        await addDoc(tasksRef(state.client.id, state.project.id), {
          title, priority, notes, startDate, endDate,
          imageUrl: imageData || null,
          status: 'todo', createdAt: serverTimestamp()
        });
        toast('تمت إضافة المهمة! 🎉', 'success');
      }
      closeModal();

    } else if (currentModalType === 'bucket') {
      const name = document.getElementById('f-bkt-name').value.trim();
      const target = document.getElementById('f-bkt-target').value;
      const icon = document.getElementById('f-bkt-icon').value.trim() || null;
      const status = document.getElementById('f-bkt-status').value || 'active';
      if (!name) { toast('يرجى إدخال اسم الوعاء', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      const payload = {
        bucketName: name,
        targetBudget: target === '' ? null : Number(target),
        icon, status,
      };
      if (state.editTarget) {
        await updateDoc(bucketDoc(state.editTarget.id), payload);
        toast('تم تعديل الوعاء', 'success');
      } else {
        await addDoc(bucketsRef(), { ...payload, createdAt: serverTimestamp() });
        toast('تم إنشاء الوعاء', 'success', '🗂️');
      }
      closeModal();

    } else if (currentModalType === 'transaction') {
      const title    = document.getElementById('f-tx-title').value.trim();
      const amount   = Number(document.getElementById('f-tx-amount').value);
      const bucketId = document.getElementById('f-tx-bucket').value || null;
      const projectId = document.getElementById('f-tx-project')?.value || null;
      const dateStr  = document.getElementById('f-tx-date').value;
      const notes    = document.getElementById('f-tx-notes')?.value.trim() || null;
      if (!title)         { toast('يرجى إدخال البيان', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!(amount > 0))  { toast('المبلغ يجب أن يكون أكبر من صفر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!bucketId)      { toast('اختر وعاء صرف نشط أولاً', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!dateStr)       { toast('يرجى تحديد التاريخ', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      const date = fromLocalISODate(dateStr);

      const payload = { title, amount, bucketId, projectId: projectId || null, date, notes };
      if (state.editTarget) {
        await updateDoc(transactionDoc(state.editTarget.id), payload);
        toast('تم تعديل المعاملة', 'success');
      } else {
        await addDoc(transactionsRef(), { ...payload, createdAt: serverTimestamp() });
        toast('تم تسجيل المعاملة', 'success', '💸');
      }
      closeModal();

    } else if (currentModalType === 'incomeSource') {
      const incType = document.getElementById('f-inc-type').value;
      const label   = document.getElementById('f-inc-label').value.trim();
      if (!label) { toast('يرجى إدخال تسمية المصدر', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      let payload = { type: incType, label };
      if (incType === 'salary') {
        const monthly = Number(document.getElementById('f-inc-monthly').value);
        if (!(monthly > 0)) { toast('الراتب الشهري يجب أن يكون أكبر من صفر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
        payload.monthlyAmount = monthly;
      } else {
        const projectId = document.getElementById('f-inc-project').value;
        const rate      = Number(document.getElementById('f-inc-rate').value);
        if (!projectId)   { toast('يرجى اختيار مشروع', 'error'); btn.disabled = false; btn.textContent = orig; return; }
        if (!(rate > 0))  { toast('سعر الساعة يجب أن يكون أكبر من صفر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
        payload.projectId  = projectId;
        payload.hourlyRate = rate;
      }

      if (state.editTarget) {
        await updateDoc(incomeSourceDoc(state.editTarget.id), payload);
        toast('تم تعديل مصدر الدخل', 'success');
      } else {
        await addDoc(incomeSourcesRef(), { ...payload, createdAt: serverTimestamp() });
        toast('تمت إضافة مصدر الدخل', 'success', '💼');
      }
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

function openConfirm({ type, id, name, warning = '', clientId = null }) {
  state.deleteTarget = { type, id, clientId };
  const titles = { client: 'حذف العميل', project: 'حذف المشروع', task: 'حذف المهمة' };
  document.getElementById('confirm-title').textContent    = titles[type] || 'حذف';
  document.getElementById('confirm-item-name').textContent = name || '';
  document.getElementById('confirm-warning').textContent  = warning;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

document.getElementById('confirm-no')?.addEventListener('click', () => {
  document.getElementById('confirm-overlay')?.classList.add('hidden');
  state.deleteTarget = null;
});

document.getElementById('confirm-yes')?.addEventListener('click', async () => {
  document.getElementById('confirm-overlay').classList.add('hidden');
  const target = state.deleteTarget;
  state.deleteTarget = null;
  if (!target) return;

  try {
    if (target.type === 'client') {
      await deleteClientCascade(target.id);
      toast('تم حذف العميل وبياناته', 'info', '🗑️');

    } else if (target.type === 'project') {
      const cId = target.clientId || state.client?.id;
      if (!cId) { toast('فشل الحذف: لم يتم العثور على العميل', 'error'); return; }
      await deleteProjectCascade(cId, target.id);
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

document.getElementById('search-clients')?.addEventListener('input',  onSearch);
document.getElementById('search-projects')?.addEventListener('input', onSearch);
document.getElementById('search-tasks')?.addEventListener('input',    onSearch);

// ════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modalOpen   = !document.getElementById('modal-overlay')?.classList.contains('hidden');
    const confirmOpen = !document.getElementById('confirm-overlay')?.classList.contains('hidden');
    if (modalOpen)   closeModal();
    if (confirmOpen) {
      document.getElementById('confirm-overlay')?.classList.add('hidden');
      state.deleteTarget = null;
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    // Only open modal when on a view that supports adding
    if (state.view === 'clients')       openModal('client');
    else if (state.view === 'projects') openModal('project');
    else if (state.view === 'tasks')    openModal('task');
  }
});


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

// Refresh timestamps every minute — skip if a search/input is focused
// or a modal is open, so we don't yank focus mid-typing.
setInterval(() => {
  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
  const modalOpen = !document.getElementById('modal-overlay')?.classList.contains('hidden');
  if (isTyping || modalOpen) return;

  // Preserve scroll position of grids/board across re-renders
  const scrollTargets = ['clients-grid', 'projects-grid', 'kanban'];
  const scrolls = {};
  scrollTargets.forEach(id => {
    const el = document.getElementById(id);
    if (el) scrolls[id] = el.scrollTop;
  });

  if (state.view === 'clients')  renderClients();
  if (state.view === 'projects') renderProjects();
  if (state.view === 'tasks')    renderKanban();
  if (state.view === 'dashboard') renderDashboard();

  // Restore scroll
  Object.entries(scrolls).forEach(([id, top]) => {
    const el = document.getElementById(id);
    if (el) el.scrollTop = top;
  });
}, 60000);

// ════════════════════════════════════════════════════════════════
//  FOCUS TIMER MODULE (v7.0)
//  3 modes (25/50/90), locked focus mode, auto-aggregate hours
//  into the project (totalProjectHours) and the task (taskHoursSpent).
// ════════════════════════════════════════════════════════════════

// ── Soft completion chime (Web Audio, no asset needed) ──
function playFocusChime(type = 'work-done') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const tones = type === 'work-done'
      ? [587.33, 880]   // D5 → A5 for work completion
      : [440, 349.23];  // A4 → F4 for break completion
    tones.forEach((freq, i) => {
      setTimeout(() => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.10, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.30);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.30);
      }, i * 160);
    });
  } catch (err) {
    console.warn('Focus chime failed:', err);
  }
}

// Round a float to N decimal places, drop trailing zeros
function roundHours(value, decimals = 2) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

function subscribeFocus() {
  // v14.6 — Focus view is project-only now. We just need clients (for the
  // sidebar badge + project ↔ client resolution in the sessions feed) and
  // projects (for the picker + gauge writes). Task listener dropped with
  // the task-select control.
  const clientQ = query(clientsRef(), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(clientQ, snap => {
    setOnline(); hideLoading();
    state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const badge = document.getElementById('total-badge');
    if (badge) badge.textContent = state.clients.length;
    renderDailySessionsFeed();
  }, err => { setOffline(); hideLoading(); console.error(err); });

  const projQ = query(collectionGroup(db, 'projects'));
  state.dashUnsubProjects = onSnapshot(projQ, snap => {
    setOnline(); hideLoading();
    state.allProjects = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      _ref: d.ref,
      _clientId: d.ref.parent.parent.id
    }));
    populateFocusProjectSelect();
    renderDailySessionsFeed();
  }, err => { setOffline(); hideLoading(); console.error(err); });

  updateFocusDisplay();
}

function populateFocusProjectSelect() {
  const sel = document.getElementById('focus-project-select');
  if (!sel) return;
  const prevValue = sel.value || state.focusProjectId || '';
  // Only "active" (or undefined-status) projects per the plan
  const projects = state.allProjects
    .filter(p => p.status === 'active' || !p.status)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

  // v17.0 Layout-guard: skip rebuild if list hasn't actually changed.
  const signature = projects.map(p => `${p.id}:${p.name}`).join('|');
  if (sel.dataset.sig === signature) return;
  sel.dataset.sig = signature;

  sel.innerHTML = '<option value="">اختر المشروع</option>' +
    projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  if (prevValue && projects.some(p => p.id === prevValue)) {
    sel.value = prevValue;
    populateFocusTaskSelect(prevValue);
  }
  renderFocusDropdown('project');
}

// v14.6 — Task-select removed from the focus view. Stub kept so existing
// callers don't break; project picker is the sole control.
function populateFocusTaskSelect(_projectId) {}

function updateFocusDisplay() {
  // Always mirror to dashboard widget (cheap, no-op when not on dashboard)
  syncDashActiveSession();

  const minEl   = document.getElementById('focus-minutes');
  const secEl   = document.getElementById('focus-seconds');
  const badgeEl = document.getElementById('focus-status-badge');
  const labelEl = document.getElementById('focus-timer-label');
  const timerEl = document.getElementById('focus-bigtimer');
  const fill    = document.getElementById('focus-progress-fill');
  if (!minEl) return;

  // MM : SS display (minutes left, seconds right — LTR forced via CSS)
  const totalSec = state.focusTimeLeft;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  minEl.textContent = String(m).padStart(2, '0');
  if (secEl) secEl.textContent = String(s).padStart(2, '0');

  // Status colour & label
  if (state.focusState === 'work') {
    timerEl?.classList.remove('break-mode');
    if (labelEl) labelEl.textContent = 'وقت العمل';
    if (badgeEl) {
      badgeEl.className = 'focus-status-badge' + (state.focusRunning ? ' running' : '');
      badgeEl.textContent = state.focusRunning ? 'جاري العمل 🔥' : 'جاهز للبدء 🌱';
    }
  } else {
    timerEl?.classList.add('break-mode');
    if (labelEl) labelEl.textContent = 'وقت الراحة';
    if (badgeEl) {
      badgeEl.className = 'focus-status-badge break';
      badgeEl.textContent = 'وقت الراحة ☕';
    }
  }

  // Top progress rail
  if (fill) {
    const total = (state.focusState === 'work' ? state.focusWorkMinutes : state.focusBreakMinutes) * 60;
    const pct = total > 0 ? ((total - state.focusTimeLeft) / total) * 100 : 0;
    fill.style.width = pct + '%';
  }

  // v14.6 — Project-only flow; keep the daily session feed in sync.
  renderDailySessionsFeed();
}

function setFocusLocked(locked) {
  const fluid = document.querySelector('.focus-fluid');
  if (fluid) fluid.classList.toggle('locked', !!locked);
}

function setFocusMode(workMinutes, breakMinutes, btn) {
  if (state.focusRunning) return; // don't allow mode change while running
  state.focusWorkMinutes  = workMinutes;
  state.focusBreakMinutes = breakMinutes;
  state.focusState        = 'work';
  state.focusTimeLeft     = workMinutes * 60;

  document.querySelectorAll('.focus-pill').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  updateFocusDisplay();
}

function startFocusTimer() {
  if (state.focusRunning) return;
  const projectSel = document.getElementById('focus-project-select');
  const taskSel    = document.getElementById('focus-task-select');

  // Allow resuming a paused session (project already bound) without re-picking
  const resuming = !!state.focusProjectId;

  // Always require a project to bind the session to (first start only)
  if (!resuming && state.focusState === 'work' && !projectSel?.value) {
    toast('اختر المشروع الأول قبل بدء الجلسة 🎯', 'error');
    const projDd = document.querySelector('.focus-dd[data-fdd="project"]');
    projDd?.classList.add('shake');
    setTimeout(() => projDd?.classList.remove('shake'), 400);
    return;
  }
  state.focusProjectId = state.focusProjectId || projectSel?.value || null;
  state.focusTaskId    = state.focusTaskId    || taskSel?.value    || null;

  state.focusRunning = true;
  const startBtn = document.getElementById('btn-focus-start');
  if (startBtn) {
    startBtn.textContent = 'إيقاف مؤقت ⏸️';
    startBtn.classList.add('running');
  }
  setFocusLocked(true);

  state.focusInterval = setInterval(focusTick, 1000);
  updateFocusDisplay();
}

function pauseFocusTimer() {
  if (!state.focusRunning) return;
  clearInterval(state.focusInterval);
  state.focusInterval = null;
  state.focusRunning = false;
  const startBtn = document.getElementById('btn-focus-start');
  if (startBtn) {
    startBtn.textContent = 'استئناف الجلسة ▶️';
    startBtn.classList.remove('running');
  }
  setFocusLocked(false);
  updateFocusDisplay();
}

function resetFocusTimer() {
  clearInterval(state.focusInterval);
  state.focusInterval = null;
  state.focusRunning = false;
  state.focusState = 'work';
  state.focusTimeLeft = state.focusWorkMinutes * 60;
  state.focusProjectId = null;
  state.focusTaskId    = null;
  const startBtn = document.getElementById('btn-focus-start');
  if (startBtn) {
    startBtn.textContent = 'ابدأ الجلسة ▶️';
    startBtn.classList.remove('running');
  }
  setFocusLocked(false);
  updateFocusDisplay();
}

function focusTick() {
  if (state.focusTimeLeft > 0) {
    state.focusTimeLeft--;
    updateFocusDisplay();
  } else {
    completeFocusCycle();
  }
}

async function completeFocusCycle() {
  clearInterval(state.focusInterval);
  state.focusInterval = null;
  state.focusRunning = false;

  if (state.focusState === 'work') {
    // Work session done → save hours, then switch to break
    playFocusChime('work-done');
    const minutes = state.focusWorkMinutes;
    const hours   = roundHours(minutes / 60);

    if (state.focusProjectId) {
      await saveFocusHours(state.focusProjectId, null, hours);
      recordDailySession(state.focusProjectId, state.focusWorkMinutes, hours);
    }
    toast(`أحسنت! انتهت جلسة العمل (${hours} ساعة) — وقت الراحة ☕`, 'success', '🎉');

    // Switch to break
    state.focusState = 'break';
    state.focusTimeLeft = state.focusBreakMinutes * 60;
    // Auto-resume in break mode
    state.focusRunning = true;
    state.focusInterval = setInterval(focusTick, 1000);
    setFocusLocked(true);
    updateFocusDisplay();
  } else {
    // Break done → accumulate rest hours, then go back to work idle
    const restHours = roundHours(state.focusBreakMinutes / 60);
    state.totalRestHours = roundHours((Number(state.totalRestHours) || 0) + restHours);
    localStorage.setItem('totalRestHours', String(state.totalRestHours));
    // Persist to Firestore (atomic, multi-device safe via increment)
    try {
      await setDoc(userStatsDoc(), {
        totalRestHours: increment(restHours),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      console.error('Failed to persist rest hours to Firestore:', err);
    }
    playFocusChime('break-done');
    toast('انتهت الراحة! جاهز لجلسة جديدة 🚀', 'info', '⏱️');

    state.focusState = 'work';
    state.focusTimeLeft = state.focusWorkMinutes * 60;
    const startBtn = document.getElementById('btn-focus-start');
    if (startBtn) {
      startBtn.textContent = 'ابدأ الجلسة ▶️';
      startBtn.classList.remove('running');
    }
    setFocusLocked(false);
    updateFocusDisplay();
  }
}

// v19.0 — Hours are now project-centric ONLY. Per-task hours were
// dropped to reduce cognitive load and Firestore writes. taskId is
// still accepted so callers don't need refactoring, but it's ignored.
async function saveFocusHours(projectId, _taskId, hours) {
  try {
    const project = state.allProjects.find(p => p.id === projectId);
    if (!project) {
      console.warn('Focus save: project not found', projectId);
      return;
    }
    const clientId = project._clientId || project._ref?.parent?.parent?.id;
    if (!clientId) {
      console.warn('Focus save: clientId missing for project', project);
      return;
    }

    // Bump the project's running hour total — single source of truth.
    await updateDoc(projectDoc(clientId, projectId), {
      totalProjectHours: increment(hours)
    });
  } catch (err) {
    console.error('Focus save: failed', err);
    toast('فشل حفظ الساعات في قاعدة البيانات', 'error');
  }
}

// ════════════════════════════════════════════════════════════════
//  v14.6 — DAILY SESSIONS FEED (today-only, localStorage-backed)
//  Each instant-log / completed cycle appends a tag here. Tags carry
//  enough info (projectId + hours) to perform a reverse-decrement on
//  the project's totalProjectHours when the user clicks (x).
// ════════════════════════════════════════════════════════════════

const DAILY_SESSIONS_KEY = 'dailySessions';

function _todayKey() {
  return toLocalISODate(new Date());
}

function loadDailySessions() {
  try {
    const raw = localStorage.getItem(DAILY_SESSIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Auto-prune to today only — yesterday's tags shouldn't linger.
    const today = _todayKey();
    return arr.filter(s => s.day === today);
  } catch { return []; }
}

function saveDailySessions(list) {
  try { localStorage.setItem(DAILY_SESSIONS_KEY, JSON.stringify(list)); }
  catch (err) { console.warn('saveDailySessions failed', err); }
}

function recordDailySession(projectId, minutes, hours) {
  const list = loadDailySessions();
  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    day: _todayKey(),
    projectId,
    minutes,
    hours,
    at: Date.now(),
  });
  saveDailySessions(list);
  renderDailySessionsFeed();
}

function renderDailySessionsFeed() {
  const feed = document.getElementById('daily-sessions-feed');
  if (!feed) return;

  const list = loadDailySessions();
  if (list.length === 0) {
    feed.innerHTML = '';
    feed.classList.add('hidden');
    return;
  }
  feed.classList.remove('hidden');

  // Newest first so the last action stays at the start of the strip.
  const sorted = [...list].sort((a, b) => b.at - a.at);

  feed.innerHTML = sorted.map(s => {
    const proj   = state.allProjects.find(p => p.id === s.projectId);
    const name   = proj ? proj.name : '— مشروع محذوف —';
    const time   = new Date(s.at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    return `
      <span class="session-tag" data-sid="${s.id}" title="${escapeHtml(name)}">
        <span class="session-tag-proj">${escapeHtml(name)}</span>
        <span class="session-tag-sep">•</span>
        <span class="session-tag-dur">${s.minutes} د</span>
        <span class="session-tag-sep">•</span>
        <span class="session-tag-time">${escapeHtml(time)}</span>
        <button type="button" class="session-tag-x" data-sid="${s.id}"
                title="تراجع وخصم الساعات" aria-label="حذف الجلسة">✕</button>
      </span>`;
  }).join('');

  feed.querySelectorAll('.session-tag-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      undoDailySession(btn.dataset.sid);
    });
  });
}

async function undoDailySession(sessionId) {
  const list = loadDailySessions();
  const idx  = list.findIndex(s => s.id === sessionId);
  if (idx < 0) return;
  const s = list[idx];

  // Optimistic UI removal — drop the tag, persist new list, then revert
  // by writing the negated hours into Firestore.
  list.splice(idx, 1);
  saveDailySessions(list);
  renderDailySessionsFeed();

  try {
    const project = state.allProjects.find(p => p.id === s.projectId);
    if (!project) {
      console.warn('Undo session: project not found', s.projectId);
      toast('تم حذف التاغ — المشروع غير موجود', 'info');
      return;
    }
    const clientId = project._clientId || project._ref?.parent?.parent?.id;
    if (!clientId) return;
    await updateDoc(projectDoc(clientId, s.projectId), {
      totalProjectHours: increment(-s.hours)
    });
    toast(`تم خصم ${s.hours} ساعة من "${project.name}"`, 'info', '↩️');
  } catch (err) {
    console.error('Undo session failed:', err);
    toast('فشل خصم الساعات — جرب مجدداً', 'error');
    // Roll the tag back if Firestore write failed.
    const rollback = loadDailySessions();
    rollback.push(s);
    saveDailySessions(rollback);
    renderDailySessionsFeed();
  }
}

// ── Wire up Focus Timer DOM (idempotent) ──
(function setupFocusTimer() {
  const projectSel = document.getElementById('focus-project-select');
  const btnQuick   = document.getElementById('btn-mode-quick');
  const btnDeep    = document.getElementById('btn-mode-deep');
  const btnFlow    = document.getElementById('btn-mode-flow');
  const btnStart   = document.getElementById('btn-focus-start');
  const btnReset   = document.getElementById('btn-focus-reset');

  if (projectSel) {
    projectSel.addEventListener('change', () => {
      state.focusProjectId = projectSel.value || null;
      state.focusTaskId = null;
    });
  }
  if (btnQuick) btnQuick.addEventListener('click', () => setFocusMode(25, 5,  btnQuick));
  if (btnDeep)  btnDeep .addEventListener('click', () => setFocusMode(50, 15, btnDeep));
  if (btnFlow)  btnFlow .addEventListener('click', () => setFocusMode(90, 20, btnFlow));

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      if (state.focusRunning) pauseFocusTimer();
      else startFocusTimer();
    });
  }
  if (btnReset) btnReset.addEventListener('click', resetFocusTimer);

  // ── Instant log: dump the currently selected preset (25 / 50 / 90) directly
  //    into the project's totalProjectHours, then push a tag into today's feed.
  const btnInstant = document.getElementById('btn-focus-instant-log');
  if (btnInstant) {
    btnInstant.addEventListener('click', async () => {
      const minutes = Number(state.focusWorkMinutes) || 0;
      if (minutes <= 0) {
        toast('اختر أحد الجلسات الجاهزة أولاً', 'error');
        return;
      }

      const projectSelEl = document.getElementById('focus-project-select');
      const projectId    = projectSelEl?.value || state.focusProjectId;

      if (!projectId) {
        toast('اختر المشروع أولاً قبل تسجيل الوقت', 'error');
        const projDd = document.querySelector('.focus-dd[data-fdd="project"]');
        projDd?.classList.add('shake');
        setTimeout(() => projDd?.classList.remove('shake'), 400);
        return;
      }

      btnInstant.disabled = true;
      const hours = roundHours(minutes / 60);
      try {
        await saveFocusHours(projectId, null, hours);
        recordDailySession(projectId, minutes, hours);
        btnInstant.classList.add('flash-success');
        setTimeout(() => btnInstant.classList.remove('flash-success'), 700);
        toast(`✅ تم تسجيل ${minutes} دقيقة (${hours} ساعة) على المشروع`, 'success');
      } catch (err) {
        console.error('Instant log failed:', err);
        toast('فشل الحفظ، تحقق من الاتصال', 'error');
      } finally {
        btnInstant.disabled = false;
      }
    });
  }
})();

// ════════════════════════════════════════════════════════════════
//  CUSTOM DROPDOWN (Focus tab)
//  A themed replacement for the native <select>. We keep the
//  native element hidden underneath so existing change handlers
//  and form semantics still work — we just replace the visuals.
// ════════════════════════════════════════════════════════════════

function getFocusDropdown(key) {
  return document.querySelector(`.focus-dd[data-fdd="${key}"]`);
}

function setFocusDropdownDisabled(key, disabled) {
  const dd = getFocusDropdown(key);
  if (!dd) return;
  dd.classList.toggle('disabled', !!disabled);
  if (disabled) closeFocusDropdown(dd);
}

function renderFocusDropdown(key) {
  const dd = getFocusDropdown(key);
  if (!dd) return;
  const sel  = dd.querySelector('.focus-dd-native');
  const menu = dd.querySelector('.focus-dd-menu');
  const text = dd.querySelector('.focus-dd-text');
  if (!sel || !menu || !text) return;

  const opts        = Array.from(sel.options);
  const placeholder = opts[0]?.value === '' ? opts[0].textContent : 'اختر';
  const realOpts    = opts.filter(o => o.value !== '');
  const current     = sel.value;
  const currentOpt  = opts.find(o => o.value === current);

  // Trigger label
  if (currentOpt && currentOpt.value) {
    text.textContent = currentOpt.textContent;
    text.classList.remove('placeholder');
  } else {
    text.textContent = text.dataset.placeholder || placeholder;
    text.classList.add('placeholder');
  }

  // Menu items
  if (realOpts.length === 0) {
    menu.innerHTML = '<div class="focus-dd-empty">لا توجد عناصر</div>';
    return;
  }
  // Add a "clear" option at the top so the user can unset
  const clearLabel = key === 'task' ? '— بدون مهمة —' : '— بدون —';
  menu.innerHTML = `
    <div class="focus-dd-item${!current ? ' selected' : ''}" data-value="">${escapeHtml(clearLabel)}</div>
    ${realOpts.map(o => `
      <div class="focus-dd-item${o.value === current ? ' selected' : ''}" data-value="${escapeHtml(o.value)}">
        ${escapeHtml(o.textContent)}
      </div>
    `).join('')}
  `;

  menu.querySelectorAll('.focus-dd-item').forEach(item => {
    item.addEventListener('click', () => {
      sel.value = item.dataset.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      closeFocusDropdown(dd);
    });
  });
}

function openFocusDropdown(dd) {
  if (dd.classList.contains('disabled')) return;
  closeAllFocusDropdowns();
  const trigger = dd.querySelector('.focus-dd-trigger');
  const menu    = dd.querySelector('.focus-dd-menu');
  trigger?.setAttribute('aria-expanded', 'true');
  menu?.classList.add('open');
}

function closeFocusDropdown(dd) {
  const trigger = dd.querySelector('.focus-dd-trigger');
  const menu    = dd.querySelector('.focus-dd-menu');
  trigger?.setAttribute('aria-expanded', 'false');
  menu?.classList.remove('open');
}

function closeAllFocusDropdowns() {
  document.querySelectorAll('.focus-dd').forEach(closeFocusDropdown);
}

// Wire triggers + outside-click close (once)
(function initFocusDropdowns() {
  document.querySelectorAll('.focus-dd').forEach(dd => {
    const trigger = dd.querySelector('.focus-dd-trigger');
    if (!trigger) return;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = trigger.getAttribute('aria-expanded') === 'true';
      if (isOpen) closeFocusDropdown(dd);
      else openFocusDropdown(dd);
    });
    // Initial render in case there's already content
    renderFocusDropdown(dd.dataset.fdd);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.focus-dd')) closeAllFocusDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllFocusDropdowns();
  });
})();


