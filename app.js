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
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

const MOBILE_BREAKPOINT = 768;
const isMobileView = () => window.innerWidth <= MOBILE_BREAKPOINT;

function openMobileSidebar() {
  if (!sidebar) return;
  sidebar.classList.add('mobile-open');
  document.body.classList.add('sidebar-drawer-open');
  if (sidebarBackdrop) sidebarBackdrop.classList.add('visible');
}

function closeMobileSidebar() {
  if (!sidebar) return;
  sidebar.classList.remove('mobile-open');
  document.body.classList.remove('sidebar-drawer-open');
  if (sidebarBackdrop) sidebarBackdrop.classList.remove('visible');
}

if (sidebar && toggleBtn) {
  // Read saved preference from localStorage (desktop collapse only)
  const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  if (isCollapsed) {
    sidebar.classList.add('collapsed');
  }

  toggleBtn.addEventListener('click', () => {
    // On mobile the toggle button just closes the drawer
    if (isMobileView()) {
      closeMobileSidebar();
      return;
    }
    const collapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', collapsed);
  });
}

if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', () => {
    if (sidebar && sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  });
}

if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener('click', closeMobileSidebar);
}

// Close drawer when any nav item is tapped on mobile
if (sidebar) {
  sidebar.addEventListener('click', (e) => {
    if (!isMobileView()) return;
    const navItem = e.target.closest('.nav-item');
    if (navItem && !navItem.classList.contains('disabled')) {
      closeMobileSidebar();
    }
  });
}

// Auto-close drawer + clear desktop collapse state when crossing breakpoint
window.addEventListener('resize', () => {
  if (!isMobileView()) {
    closeMobileSidebar();
  }
});

// Close drawer with Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebar && sidebar.classList.contains('mobile-open')) {
    closeMobileSidebar();
  }
});

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
// v8 — Envelope-based finance hub collections.
//   envelopes — user-defined money envelopes with computed balance
//   incomes   — every income event; `allocated:false` until distributed 100%
//   expenses  — every spend, tied to one envelope
//   transfers — moving money between envelopes
const envelopesRef = ()       => collection(db, 'envelopes');
const envelopeDoc  = (id)     => doc(db, 'envelopes', id);
const incomesRef   = ()       => collection(db, 'incomes');
const incomeDoc    = (id)     => doc(db, 'incomes', id);
const expensesRef  = ()       => collection(db, 'expenses');
const expenseDoc   = (id)     => doc(db, 'expenses', id);
const transfersRef = ()       => collection(db, 'transfers');
const transferDoc  = (id)     => doc(db, 'transfers', id);
const sourcesRef   = ()       => collection(db, 'sources');
const sourceDoc    = (id)     => doc(db, 'sources', id);
// v15 — Cloud-mirrored pomodoro log so the nightly report can read today's focus.
const focusSessionsRef = ()   => collection(db, 'focusSessions');

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
  // Finance Hub (v8 — envelopes + mandatory allocation)
  envelopes:            [],       // envelopes collection
  incomes:              [],       // incomes collection (allocated true/false)
  expenses:             [],       // expenses collection
  transfers:            [],       // transfers collection
  sources:              [],       // user-defined income sources (Company X, Freelance, etc.)
  financeUnsubEnvelopes: null,
  financeUnsubIncomes:   null,
  financeUnsubExpenses:  null,
  financeUnsubTransfers: null,
  financeUnsubSources:   null,
  financeTxTab:         'all',    // 'all' | 'income' | 'expense' | 'transfer'
  isPrivacyActive:      true,  // v22.2 — Always start hidden on every page load; toggle is session-only.
  selectedTxIds:        new Set(),  // v22.5 — keys "kind:id" for bulk-delete in tx list
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
  safeUnsub(state.financeUnsubEnvelopes); state.financeUnsubEnvelopes = null;
  safeUnsub(state.financeUnsubIncomes);   state.financeUnsubIncomes   = null;
  safeUnsub(state.financeUnsubExpenses);  state.financeUnsubExpenses  = null;
  safeUnsub(state.financeUnsubTransfers); state.financeUnsubTransfers = null;
  safeUnsub(state.financeUnsubSources);   state.financeUnsubSources   = null;
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
      // v22.3 — Frame each avatar by the status of THIS client's tasks ON
      // THIS DAY: green = all done, red = none done, orange = mixed.
      const clientTasksToday = tasksToday.filter(t => t._clientId === c.id);
      const doneCount = clientTasksToday.filter(t => t.status === 'done').length;
      let statusCls = '';
      if (clientTasksToday.length > 0) {
        if      (doneCount === clientTasksToday.length) statusCls = 'cal-avatar-done';
        else if (doneCount === 0)                       statusCls = 'cal-avatar-pending';
        else                                            statusCls = 'cal-avatar-mixed';
      }
      const inner = c.avatarUrl
        ? `<img src="${c.avatarUrl}" alt="${escapeHtml(c.name || '')}" />`
        : escapeHtml(getInitials(c.name || '—'));
      const bg = c.avatarUrl ? 'transparent' : escapeHtml(c.color || '#3574F0');
      return `<span class="cal-client-avatar ${statusCls}" style="background:${bg}" title="${escapeHtml(c.name || '')}">${inner}</span>`;
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
        await updateDoc(taskDoc(cid, pid, tid), { status: 'done', completedAt: serverTimestamp() });
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
//  FINANCE HUB (v8 — Envelopes & Mandatory Pre-Allocation)
//
//  Data model:
//    envelopes — { id, name, icon, sortOrder, createdAt }
//    incomes   — { id, amount, source, paymentType, notes, date,
//                  allocated:bool, allocations:{envelopeId:amount},
//                  createdAt }
//                When allocated=false, the money is frozen and NOT
//                available to spend until the user distributes 100%.
//    expenses  — { id, amount, envelopeId, note, date, createdAt }
//                Blocked at write time if envelopeId balance < amount.
//    transfers — { id, amount, fromEnvelopeId, toEnvelopeId, note,
//                  date, createdAt }
//
//  Balance per envelope is computed live:
//    + Σ allocations[envelopeId] for every income where allocated=true
//    + Σ transfers where toEnvelopeId  = envelopeId
//    − Σ transfers where fromEnvelopeId = envelopeId
//    − Σ expenses where envelopeId = envelopeId
// ════════════════════════════════════════════════════════════════

// Latin-digit money formatter — keeps numbers stable across the dark UI
// (Arabic locale plus toLocaleString('en-US') gives the 1,234.56 shape
// that JetBrains Mono renders cleanly without RTL surprises).
function formatMoney(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  const opts = Number.isInteger(v)
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  try { return v.toLocaleString('en-US', opts); }
  catch { return String(v); }
}

// PhpStorm-friendly accent palette. Cycled through new envelopes/sources
// when the user doesn't pick one explicitly. Each entry: { color, dim }
// — `color` is the solid accent, `dim` is the faint tint we paint behind
// cards/avatars so the UI feels coloured without screaming.
const FINANCE_PALETTE = [
  { color: '#3574F0', dim: 'rgba(53,116,240,0.14)'  }, // blue
  { color: '#3DB981', dim: 'rgba(61,185,129,0.14)'  }, // green
  { color: '#F0A835', dim: 'rgba(240,168,53,0.14)'  }, // amber
  { color: '#E05C5C', dim: 'rgba(224,92,92,0.14)'   }, // red
  { color: '#9B59B6', dim: 'rgba(155,89,182,0.14)'  }, // purple
  { color: '#1ABC9C', dim: 'rgba(26,188,156,0.14)'  }, // teal
  { color: '#E891C8', dim: 'rgba(232,145,200,0.14)' }, // pink
  { color: '#5C8DEC', dim: 'rgba(92,141,236,0.14)'  }, // soft blue
];

function paletteAt(seed) {
  const i = Math.abs(seed | 0) % FINANCE_PALETTE.length;
  return FINANCE_PALETTE[i];
}

function colorDim(hex) {
  // Convert #RRGGBB to rgba(r,g,b,0.14) for inline gradients.
  if (!hex || hex[0] !== '#' || hex.length !== 7) return 'rgba(255,255,255,0.08)';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.14)`;
}

const PAYMENT_TYPE_LABELS = {
  salary:           'مرتب',
  project_advance:  'مقدم مشروع',
  project_payment:  'دفعة من مشروع',
  project_final:    'نهاية مشروع',
  adjustment:       'فلوس تعديل',
  other:            'أخرى',
};

// Resolve an income's `source` field (which is now a sourceId pointing at
// the `sources` collection) to its display label/icon/color. Falls back
// gracefully if the source has been deleted since the income was saved.
function resolveSource(sourceId) {
  const src = state.sources.find(s => s.id === sourceId);
  if (src) return { label: src.name, icon: src.icon || '💼', color: src.color || '#3574F0' };
  return { label: 'مصدر محذوف', icon: '❔', color: '#7F8B96' };
}

// First-run seed of the default envelopes from the v8 spec.
const DEFAULT_ENVELOPES = [
  { name: 'مصاريف الجواز',    icon: '💍', color: '#E891C8' },
  { name: 'الطوارئ',          icon: '🚨', color: '#E05C5C' },
  { name: 'التزامات أساسية',  icon: '🏠', color: '#3574F0' },
  { name: 'الرفاهية والأكل',  icon: '🍔', color: '#F0A835' },
];
const DEFAULT_SOURCES = [
  { name: 'الشركة 1', icon: '🏢', color: '#3574F0' },
  { name: 'الشركة 2', icon: '🏬', color: '#3DB981' },
  { name: 'فري لانس', icon: '💻', color: '#9B59B6' },
];

let _seededEnvelopes = false;
let _seededSources   = false;
async function seedDefaultEnvelopesIfEmpty() {
  if (_seededEnvelopes) return;
  if (state.envelopes.length > 0) { _seededEnvelopes = true; return; }
  _seededEnvelopes = true;
  try {
    for (let i = 0; i < DEFAULT_ENVELOPES.length; i++) {
      const d = DEFAULT_ENVELOPES[i];
      await addDoc(envelopesRef(), {
        name: d.name, icon: d.icon, color: d.color,
        sortOrder: i, createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error('seed envelopes failed:', err);
    _seededEnvelopes = false;
  }
}
async function seedDefaultSourcesIfEmpty() {
  if (_seededSources) return;
  if (state.sources.length > 0) { _seededSources = true; return; }
  _seededSources = true;
  try {
    for (let i = 0; i < DEFAULT_SOURCES.length; i++) {
      const d = DEFAULT_SOURCES[i];
      await addDoc(sourcesRef(), {
        name: d.name, icon: d.icon, color: d.color,
        sortOrder: i, createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error('seed sources failed:', err);
    _seededSources = false;
  }
}

// ── Firestore subscriptions ─────────────────────────────────────
function subscribeFinance() {
  applyPrivacyMode();
  wireFinanceToolbar();

  if (!state.financeUnsubEnvelopes) {
    state.financeUnsubEnvelopes = onSnapshot(query(envelopesRef(), orderBy('sortOrder', 'asc')), snap => {
      setOnline(); hideLoading();
      state.envelopes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.envelopes.length === 0) seedDefaultEnvelopesIfEmpty();
      debounceRender(renderFinance);
    }, err => {
      console.error('envelopes listener:', err);
      // Fallback ordering when sortOrder missing on some docs
      state.financeUnsubEnvelopes = onSnapshot(envelopesRef(), s2 => {
        state.envelopes = s2.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        if (state.envelopes.length === 0) seedDefaultEnvelopesIfEmpty();
        debounceRender(renderFinance);
      });
    });
  }
  if (!state.financeUnsubIncomes) {
    state.financeUnsubIncomes = onSnapshot(query(incomesRef(), orderBy('date', 'desc')), snap => {
      setOnline(); hideLoading();
      state.incomes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      debounceRender(renderFinance);
    }, err => { console.error('incomes listener:', err); toast('فشل تحميل الدخل', 'error'); });
  }
  if (!state.financeUnsubExpenses) {
    state.financeUnsubExpenses = onSnapshot(query(expensesRef(), orderBy('date', 'desc')), snap => {
      setOnline(); hideLoading();
      state.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      debounceRender(renderFinance);
    }, err => { console.error('expenses listener:', err); });
  }
  if (!state.financeUnsubTransfers) {
    state.financeUnsubTransfers = onSnapshot(query(transfersRef(), orderBy('date', 'desc')), snap => {
      setOnline(); hideLoading();
      state.transfers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      debounceRender(renderFinance);
    }, err => { console.error('transfers listener:', err); });
  }
  if (!state.financeUnsubSources) {
    state.financeUnsubSources = onSnapshot(query(sourcesRef(), orderBy('sortOrder', 'asc')), snap => {
      setOnline(); hideLoading();
      state.sources = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.sources.length === 0) seedDefaultSourcesIfEmpty();
      debounceRender(renderFinance);
    }, err => {
      console.error('sources listener:', err);
      // Fallback when sortOrder missing
      state.financeUnsubSources = onSnapshot(sourcesRef(), s2 => {
        state.sources = s2.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        if (state.sources.length === 0) seedDefaultSourcesIfEmpty();
        debounceRender(renderFinance);
      });
    });
  }
}

// ── Balance maths ───────────────────────────────────────────────
// `excludeExpenseId` and `excludeTransferId` let edit-flows ignore the doc
// they are currently editing so its old amount doesn't double-count.
function computeEnvelopeBalance(envelopeId, excludeExpenseId = null, excludeTransferId = null) {
  let bal = 0;
  state.incomes.forEach(inc => {
    if (!inc.allocated || !inc.allocations) return;
    const a = Number(inc.allocations[envelopeId]) || 0;
    bal += a;
  });
  state.transfers.forEach(tr => {
    if (tr.id === excludeTransferId) return;
    if (tr.toEnvelopeId   === envelopeId) bal += Number(tr.amount) || 0;
    if (tr.fromEnvelopeId === envelopeId) bal -= Number(tr.amount) || 0;
  });
  state.expenses.forEach(ex => {
    if (ex.id === excludeExpenseId) return;
    if (ex.envelopeId === envelopeId) bal -= Number(ex.amount) || 0;
  });
  return bal;
}

function envelopeState(balance, totalAllocatedToThisEnvelope) {
  // 'empty' when balance <= 0, 'warn' when below 15% of cumulative allocation
  if (balance <= 0.001) return 'empty';
  if (totalAllocatedToThisEnvelope > 0 && balance < totalAllocatedToThisEnvelope * 0.15) return 'warn';
  return 'ok';
}

function totalAllocatedToEnvelope(envelopeId) {
  let sum = 0;
  state.incomes.forEach(inc => {
    if (!inc.allocated || !inc.allocations) return;
    sum += Number(inc.allocations[envelopeId]) || 0;
  });
  state.transfers.forEach(tr => {
    if (tr.toEnvelopeId === envelopeId) sum += Number(tr.amount) || 0;
  });
  return sum;
}

// ── Top-level render ────────────────────────────────────────────
function renderFinance() {
  if (!document.getElementById('view-finance')?.classList.contains('active')) return;

  // 1) Pending-allocation strip
  const pendingIncomes = state.incomes.filter(i => !i.allocated);
  const strip = document.getElementById('fin-pending-strip');
  if (strip) {
    if (pendingIncomes.length > 0) {
      strip.hidden = false;
      const totalPending = pendingIncomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      document.getElementById('fin-pending-sub').innerHTML =
        `<span class="privacy-sensitive">${formatMoney(totalPending)}</span> ج.م في <strong>${pendingIncomes.length}</strong> معاملة — لا يمكن صرفها قبل التوزيع`;
      const cta = document.getElementById('fin-pending-cta');
      if (cta) cta.onclick = () => openModal('allocate', pendingIncomes[0].id);
    } else {
      strip.hidden = true;
    }
  }

  // 2) Headline stats
  const totalBalance = state.envelopes.reduce((s, e) => s + computeEnvelopeBalance(e.id), 0);
  const totalPending = state.incomes.filter(i => !i.allocated)
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalSpent = state.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalIncome = state.incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  setText('fin-stat-balance', formatMoney(totalBalance));
  setText('fin-stat-balance-sub', `${state.envelopes.length} ظرف`);
  setText('fin-stat-pending', formatMoney(totalPending));
  setText('fin-stat-pending-sub', `${state.incomes.filter(i => !i.allocated).length} معاملة مجمَّدة`);
  setText('fin-stat-spent', formatMoney(totalSpent));
  setText('fin-stat-spent-sub', `${state.expenses.length} عملية`);
  setText('fin-stat-income', formatMoney(totalIncome));
  setText('fin-stat-income-sub', `${state.incomes.length} معاملة دخل`);

  // 3) Envelopes grid
  renderEnvelopesGrid();

  // 4) Transactions feed
  renderTransactionsFeed();
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

// ── Envelopes grid (entity-card pattern, matches Clients page) ──
function renderEnvelopesGrid() {
  const grid = document.getElementById('fin-envelopes-grid');
  const cnt  = document.getElementById('fin-envelopes-count');
  if (!grid) return;
  cnt && (cnt.textContent = `${state.envelopes.length} ظرف`);

  if (state.envelopes.length === 0) {
    grid.innerHTML = `
      <div class="finance-empty">
        <span class="finance-empty-icon">📂</span>
        <span class="finance-empty-text">لا يوجد أظرف بعد</span>
        <span class="finance-empty-sub">أضف أول ظرف من الزر أعلى الشاشة</span>
      </div>`;
    return;
  }

  grid.innerHTML = state.envelopes.map((env, idx) => {
    const color   = env.color || paletteAt(idx).color;
    const dim     = colorDim(color);
    const balance = computeEnvelopeBalance(env.id);
    const allocated = totalAllocatedToEnvelope(env.id);
    const st  = envelopeState(balance, allocated);
    const cls = st === 'empty' ? 'is-empty' : st === 'warn' ? 'is-warn' : '';
    const stBadge =
        st === 'empty' ? `<span class="env-pill env-pill-empty">⛔ فاضي</span>`
      : st === 'warn'  ? `<span class="env-pill env-pill-warn">🟡 قارب الانتهاء</span>`
      :                  `<span class="env-pill env-pill-ok">🟢 متاح</span>`;
    const pct = allocated > 0 ? Math.max(0, Math.min(100, (balance / allocated) * 100)) : 0;
    return `
      <div class="envelope-card entity-card ${cls}" data-id="${env.id}"
           style="--env-color:${color}; --env-dim:${dim};"
           role="button" tabindex="0">
        <div class="card-header-row">
          <div class="card-avatar env-avatar" style="background:${color};">${escapeHtml(env.icon || '📂')}</div>
          <div class="card-top-actions">
            <button class="card-edit-btn" data-act="edit-envelope" data-id="${env.id}" title="تعديل">✏️</button>
            <button class="card-del-btn" data-act="del-envelope" data-id="${env.id}" title="حذف">🗑️</button>
          </div>
        </div>
        <div class="card-name">${escapeHtml(env.name || 'بدون اسم')}</div>
        <div class="env-balance-row">
          <span class="env-balance-label">الرصيد المتاح</span>
          <span class="env-balance-value privacy-sensitive">${formatMoney(balance)}</span>
        </div>
        <div class="env-bar"><div class="env-bar-fill" style="width:${pct}%; background:${color};"></div></div>
        <div class="card-meta env-meta">
          ${stBadge}
          <span class="env-allocated privacy-sensitive">من ${formatMoney(allocated)}</span>
        </div>
      </div>`;
  }).join('');
}

// ── Transactions feed (tabs: all / income / expense / transfer) ──
function renderTransactionsFeed() {
  const list = document.getElementById('fin-tx-list');
  const cnt  = document.getElementById('fin-tx-count');
  if (!list) return;

  // Unified timeline — sorted by date desc
  const incomeItems = state.incomes.map(i => ({
    kind: 'income', id: i.id, date: parseDateField(i.date),
    amount: Number(i.amount) || 0, raw: i,
  }));
  const expenseItems = state.expenses.map(e => ({
    kind: 'expense', id: e.id, date: parseDateField(e.date),
    amount: Number(e.amount) || 0, raw: e,
  }));
  const transferItems = state.transfers.map(t => ({
    kind: 'transfer', id: t.id, date: parseDateField(t.date),
    amount: Number(t.amount) || 0, raw: t,
  }));

  let all = [...incomeItems, ...expenseItems, ...transferItems];
  all.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

  const tab = state.financeTxTab || 'all';
  const filtered = tab === 'all' ? all : all.filter(it => it.kind === tab);

  cnt && (cnt.textContent = `${filtered.length} معاملة`);

  if (filtered.length === 0) {
    state.selectedTxIds.clear();
    renderTxBulkBar(0, 0);
    list.innerHTML = `
      <div class="finance-empty">
        <span class="finance-empty-icon">📋</span>
        <span class="finance-empty-text">لا يوجد معاملات بعد</span>
        <span class="finance-empty-sub">سجِّل أول دخل أو مصروف من الأزرار أعلى الشاشة</span>
      </div>`;
    return;
  }

  // v22.5 — Prune selection of any ids no longer in the current filter
  const visibleKeys = new Set(filtered.map(it => `${it.kind}:${it.id}`));
  for (const key of [...state.selectedTxIds]) {
    if (!visibleKeys.has(key)) state.selectedTxIds.delete(key);
  }

  list.innerHTML = filtered.map(it => renderTxRow(it)).join('');
  renderTxBulkBar(state.selectedTxIds.size, filtered.length);
}

// v22.5 — Selection bulk-action bar. Lives at the top of the tx section
// head and only shows itself when at least one row is selected.
function renderTxBulkBar(selectedCount, totalVisible) {
  let bar = document.getElementById('fin-tx-bulk-bar');
  const section = document.getElementById('fin-tx-section');
  if (!section) return;
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fin-tx-bulk-bar';
    bar.className = 'finance-tx-bulk-bar';
    bar.hidden = true;
    // Insert just after the section head, before the tx list
    const head = section.querySelector('.finance-section-head');
    if (head && head.nextSibling) section.insertBefore(bar, head.nextSibling);
    else section.appendChild(bar);
  }

  if (selectedCount === 0) {
    bar.hidden = true;
    bar.innerHTML = '';
    // Also reset the select-all checkbox state if present
    const selAll = document.getElementById('fin-tx-select-all');
    if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
    return;
  }

  bar.hidden = false;
  const allSelected = selectedCount >= totalVisible && totalVisible > 0;
  bar.innerHTML = `
    <span class="finance-tx-bulk-count">تم اختيار <strong>${selectedCount}</strong> من ${totalVisible}</span>
    <button type="button" class="finance-tx-bulk-btn" data-act="bulk-clear">إلغاء</button>
    <button type="button" class="finance-tx-bulk-btn is-danger" data-act="bulk-delete">🗑️ حذف المحدد</button>
  `;

  const selAll = document.getElementById('fin-tx-select-all');
  if (selAll) {
    selAll.checked = allSelected;
    selAll.indeterminate = !allSelected && selectedCount > 0;
  }
}

function renderTxRow(it) {
  const dateStr = it.date ? formatDateAr(it.date) : '—';
  // v22.5 — Per-row select checkbox. Reflects state.selectedTxIds.
  const key       = `${it.kind}:${it.id}`;
  const selected  = state.selectedTxIds.has(key);
  const selectCol = `
    <label class="finance-tx-select" title="اختيار">
      <input type="checkbox" class="finance-tx-check" data-key="${key}" ${selected ? 'checked' : ''} />
      <span class="finance-tx-check-box" aria-hidden="true"></span>
    </label>`;
  const rowSelectedCls = selected ? 'is-selected' : '';

  if (it.kind === 'income') {
    const r = it.raw;
    const src = resolveSource(r.source);
    const pt  = PAYMENT_TYPE_LABELS[r.paymentType] || r.paymentType || '';
    const pending = !r.allocated;
    return `
      <div class="finance-tx-row is-income ${pending ? 'is-pending' : ''} ${rowSelectedCls}" data-kind="income" data-id="${r.id}"
           style="--row-color:${src.color}; --row-dim:${colorDim(src.color)};">
        ${selectCol}
        <div class="finance-tx-icon" style="background:${colorDim(src.color)}; color:${src.color};">${pending ? '⏳' : src.icon}</div>
        <div class="finance-tx-body">
          <div class="finance-tx-title">${escapeHtml(src.label)} • ${escapeHtml(pt)}${pending ? ' • <strong>غير موزَّع</strong>' : ''}</div>
          <div class="finance-tx-sub">${dateStr}${r.notes ? ' • ' + escapeHtml(r.notes) : ''}</div>
        </div>
        <div class="finance-tx-amount privacy-sensitive">+${formatMoney(it.amount)}</div>
        <div class="finance-tx-actions">
          ${pending ? `<button class="finance-tx-action is-allocate" data-act="allocate" data-id="${r.id}">وزِّع</button>` : ''}
          <button class="finance-tx-action" data-act="edit-income" data-id="${r.id}" title="تعديل">✎</button>
          <button class="finance-tx-action is-danger" data-act="del-income" data-id="${r.id}" title="حذف">✕</button>
        </div>
      </div>`;
  }
  if (it.kind === 'expense') {
    const r = it.raw;
    const env = state.envelopes.find(e => e.id === r.envelopeId);
    const color = env?.color || '#E05C5C';
    const envLabel = env ? `${env.icon || '📂'} ${env.name}` : 'ظرف محذوف';
    return `
      <div class="finance-tx-row is-expense ${rowSelectedCls}" data-kind="expense" data-id="${r.id}"
           style="--row-color:${color}; --row-dim:${colorDim(color)};">
        ${selectCol}
        <div class="finance-tx-icon" style="background:${colorDim(color)}; color:${color};">💸</div>
        <div class="finance-tx-body">
          <div class="finance-tx-title">${escapeHtml(r.note || 'مصروف')}</div>
          <div class="finance-tx-sub">${escapeHtml(envLabel)} • ${dateStr}</div>
        </div>
        <div class="finance-tx-amount privacy-sensitive">-${formatMoney(it.amount)}</div>
        <div class="finance-tx-actions">
          <button class="finance-tx-action" data-act="edit-expense" data-id="${r.id}" title="تعديل">✎</button>
          <button class="finance-tx-action is-danger" data-act="del-expense" data-id="${r.id}" title="حذف">✕</button>
        </div>
      </div>`;
  }
  // transfer
  const r = it.raw;
  const fromE = state.envelopes.find(e => e.id === r.fromEnvelopeId);
  const toE   = state.envelopes.find(e => e.id === r.toEnvelopeId);
  const fromLabel = fromE ? `${fromE.icon || '📂'} ${fromE.name}` : 'ظرف محذوف';
  const toLabel   = toE   ? `${toE.icon   || '📂'} ${toE.name}`   : 'ظرف محذوف';
  const trColor = '#9B59B6';
  return `
    <div class="finance-tx-row is-transfer ${rowSelectedCls}" data-kind="transfer" data-id="${r.id}"
         style="--row-color:${trColor}; --row-dim:${colorDim(trColor)};">
      ${selectCol}
      <div class="finance-tx-icon" style="background:${colorDim(trColor)}; color:${trColor};">↔</div>
      <div class="finance-tx-body">
        <div class="finance-tx-title">${escapeHtml(fromLabel)} ← ${escapeHtml(toLabel)}</div>
        <div class="finance-tx-sub">${dateStr}${r.note ? ' • ' + escapeHtml(r.note) : ''}</div>
      </div>
      <div class="finance-tx-amount privacy-sensitive">${formatMoney(it.amount)}</div>
      <div class="finance-tx-actions">
        <button class="finance-tx-action" data-act="edit-transfer" data-id="${r.id}" title="تعديل">✎</button>
        <button class="finance-tx-action is-danger" data-act="del-transfer" data-id="${r.id}" title="حذف">✕</button>
      </div>
    </div>`;
}

function formatDateAr(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Toolbar wiring (privacy eye, add buttons, tabs, row actions) ──
let _financeToolbarWired = false;
function wireFinanceToolbar() {
  if (_financeToolbarWired) return;
  _financeToolbarWired = true;

  // Privacy eye — toggle is session-only so default-hidden returns on every reload.
  document.getElementById('fin-privacy-toggle')?.addEventListener('click', () => {
    state.isPrivacyActive = !state.isPrivacyActive;
    applyPrivacyMode();
  });

  document.getElementById('btn-add-income')   ?.addEventListener('click', () => openModal('income'));
  document.getElementById('btn-add-expense')  ?.addEventListener('click', () => openModal('expense'));
  document.getElementById('btn-add-transfer') ?.addEventListener('click', () => openModal('transfer'));
  document.getElementById('btn-add-envelope') ?.addEventListener('click', () => openModal('envelope'));

  // Tabs
  document.getElementById('fin-tx-tabs')?.addEventListener('click', e => {
    const tabBtn = e.target.closest('.finance-tx-tab');
    if (!tabBtn) return;
    document.querySelectorAll('#fin-tx-tabs .finance-tx-tab').forEach(b => b.classList.remove('active'));
    tabBtn.classList.add('active');
    state.financeTxTab = tabBtn.dataset.tab || 'all';
    // v22.5 — Tab switch resets selection (different visible rows)
    state.selectedTxIds.clear();
    renderTransactionsFeed();
  });

  // v22.5 — Select-all checkbox in section head
  document.getElementById('fin-tx-select-all')?.addEventListener('change', e => {
    const visibleRows = document.querySelectorAll('#fin-tx-list .finance-tx-row[data-id]');
    if (e.target.checked) {
      visibleRows.forEach(row => {
        state.selectedTxIds.add(`${row.dataset.kind}:${row.dataset.id}`);
      });
    } else {
      state.selectedTxIds.clear();
    }
    renderTransactionsFeed();
  });

  // v22.5 — Bulk-bar buttons (cancel / delete-selected)
  document.getElementById('fin-tx-section')?.addEventListener('click', async e => {
    const btn = e.target.closest('.finance-tx-bulk-btn');
    if (!btn) return;
    if (btn.dataset.act === 'bulk-clear') {
      state.selectedTxIds.clear();
      renderTransactionsFeed();
      return;
    }
    if (btn.dataset.act === 'bulk-delete') {
      const count = state.selectedTxIds.size;
      if (count === 0) return;
      const ok = await confirmDialog({
        title: 'حذف المعاملات المحددة',
        message: `هل تريد حذف ${count} معاملة؟ (لا يمكن التراجع)`,
        icon: '🗑️',
      });
      if (!ok) return;
      const items = [...state.selectedTxIds];
      let okCount = 0, failCount = 0;
      for (const key of items) {
        const [kind, id] = key.split(':');
        try {
          if      (kind === 'income')   await deleteDoc(incomeDoc(id));
          else if (kind === 'expense')  await deleteDoc(expenseDoc(id));
          else if (kind === 'transfer') await deleteDoc(transferDoc(id));
          okCount++;
        } catch (err) { console.error(err); failCount++; }
      }
      state.selectedTxIds.clear();
      if (failCount === 0) toast(`تم حذف ${okCount} معاملة`, 'info', '🗑️');
      else                 toast(`تم حذف ${okCount} وفشل ${failCount}`, failCount === items.length ? 'error' : 'info');
    }
  });

  // Envelope-card actions (explicit edit / delete buttons; card body opens edit)
  document.getElementById('fin-envelopes-grid')?.addEventListener('click', async (e) => {
    const delBtn  = e.target.closest('[data-act="del-envelope"]');
    const editBtn = e.target.closest('[data-act="edit-envelope"]');
    if (delBtn) {
      e.stopPropagation();
      const id = delBtn.dataset.id;
      const env = state.envelopes.find(x => x.id === id);
      const balance = computeEnvelopeBalance(id);
      if (Math.abs(balance) > 0.005) {
        toast(`🚫 الظرف فيه ${formatMoney(balance)} ج.م — افضّيه الأول (تحويل لظرف تاني)`, 'error');
        return;
      }
      const ok = await confirmDialog({
        title: 'حذف الظرف',
        message: `هل تريد حذف الظرف "${env?.name || ''}"؟`,
        icon: '📂',
      });
      if (!ok) return;
      try { await deleteDoc(envelopeDoc(id)); toast('تم حذف الظرف', 'info', '🗑️'); }
      catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
      return;
    }
    if (editBtn) {
      e.stopPropagation();
      openModal('envelope', editBtn.dataset.id);
      return;
    }
    const card = e.target.closest('.envelope-card');
    if (card) openModal('envelope', card.dataset.id);
  });

  // v22.5 — Per-row select checkbox (delegated change event)
  document.getElementById('fin-tx-list')?.addEventListener('change', e => {
    const cb = e.target.closest('.finance-tx-check');
    if (!cb) return;
    const key = cb.dataset.key;
    if (cb.checked) state.selectedTxIds.add(key);
    else            state.selectedTxIds.delete(key);
    // Toggle row highlight + update bulk bar without a full re-render
    const row = cb.closest('.finance-tx-row');
    if (row) row.classList.toggle('is-selected', cb.checked);
    const totalVisible = document.querySelectorAll('#fin-tx-list .finance-tx-row[data-id]').length;
    renderTxBulkBar(state.selectedTxIds.size, totalVisible);
  });

  // Tx-row actions
  document.getElementById('fin-tx-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.finance-tx-action');
    if (!btn) return;
    const id  = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'allocate')       openModal('allocate', id);
    else if (act === 'edit-income')   openModal('income',   id);
    else if (act === 'edit-expense')  openModal('expense',  id);
    else if (act === 'edit-transfer') openModal('transfer', id);
    else if (act.startsWith('del-')) {
      const kind = act.slice(4); // income / expense / transfer
      const ok = await confirmDialog({
        title: 'حذف المعاملة',
        message: 'هل تريد حذف هذه المعاملة؟ (لا يمكن التراجع)',
        icon: '🗑️',
      });
      if (!ok) return;
      try {
        if (kind === 'income')   await deleteDoc(incomeDoc(id));
        if (kind === 'expense')  await deleteDoc(expenseDoc(id));
        if (kind === 'transfer') await deleteDoc(transferDoc(id));
        toast('تم الحذف', 'info', '🗑️');
      } catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
    }
  });
}

// ── Privacy mode (eye icon swap + body class) ──
function applyPrivacyMode() {
  document.body.classList.toggle('privacy-on', state.isPrivacyActive);
  const btn = document.getElementById('fin-privacy-toggle');
  if (btn) {
    btn.classList.toggle('privacy-on', state.isPrivacyActive);
    btn.setAttribute('aria-pressed', state.isPrivacyActive ? 'true' : 'false');
    btn.title = state.isPrivacyActive ? 'إظهار الأرقام' : 'إخفاء الأرقام';
  }
}

// ── Color swatch row used by envelope/source modals ──
function setupColorSwatchRow(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const target = document.getElementById(row.dataset.target);
  if (!target) return;
  const current = target.value || FINANCE_PALETTE[0].color;
  row.innerHTML = FINANCE_PALETTE.map(p => `
    <button type="button" class="color-swatch ${p.color.toLowerCase() === current.toLowerCase() ? 'is-active' : ''}"
            data-color="${p.color}" style="background:${p.color};" aria-label="${p.color}"></button>
  `).join('');
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch');
    if (!btn) return;
    target.value = btn.dataset.color;
    row.querySelectorAll('.color-swatch').forEach(b => b.classList.toggle('is-active', b === btn));
  });
}

// ── Income modal — dynamic source picker + manage link ──
function setupIncomeSourcePicker() {
  const sel = document.getElementById('f-inc-source');
  if (!sel) return;
  if (state.sources.length === 0) {
    sel.innerHTML = `<option value="">⚠️ لا يوجد مصادر — أضف من ⚙️ إدارة المصادر</option>`;
  } else {
    const prev = sel.value;
    sel.innerHTML = state.sources.map(s =>
      `<option value="${s.id}">${escapeHtml(s.icon || '💼')} ${escapeHtml(s.name)}</option>`
    ).join('');
    if (prev && state.sources.some(s => s.id === prev)) sel.value = prev;
  }
  document.getElementById('f-inc-manage-sources')?.addEventListener('click', () => {
    // Stash the current income-modal form values so we can restore after manage closes
    openModal('sources_manage');
  });
}

// ── Sources manage modal — inline list with add/edit/delete ──
function setupSourcesManageModal() {
  const list = document.getElementById('sources-manage-list');
  const addBtn = document.getElementById('sources-manage-add');
  if (!list || !addBtn) return;

  const renderList = () => {
    if (state.sources.length === 0) {
      list.innerHTML = `<div class="manage-empty">لا يوجد مصادر بعد — أضف مصدر جديد</div>`;
      return;
    }
    list.innerHTML = state.sources.map(s => `
      <div class="manage-row" data-id="${s.id}">
        <div class="manage-icon" style="background:${s.color || '#3574F0'};">${escapeHtml(s.icon || '💼')}</div>
        <div class="manage-name">${escapeHtml(s.name)}</div>
        <button type="button" class="manage-action" data-act="edit-source" data-id="${s.id}" title="تعديل">✏️</button>
        <button type="button" class="manage-action is-danger" data-act="del-source" data-id="${s.id}" title="حذف">🗑️</button>
      </div>
    `).join('');
  };
  renderList();

  // Re-render whenever sources change while this modal is open.
  // (Listeners already update state.sources via Firestore snapshots.)
  const observerId = setInterval(() => {
    if (currentModalType !== 'sources_manage') { clearInterval(observerId); return; }
    if (list.dataset.sig !== sourcesSignature()) {
      list.dataset.sig = sourcesSignature();
      renderList();
    }
  }, 250);
  list.dataset.sig = sourcesSignature();

  addBtn.onclick = () => openModal('source');

  list.onclick = async (e) => {
    const btn = e.target.closest('.manage-action');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'edit-source') {
      openModal('source', id);
    } else if (btn.dataset.act === 'del-source') {
      const src = state.sources.find(s => s.id === id);
      // Guard: refuse to delete if any income references this source.
      const inUse = state.incomes.some(inc => inc.source === id);
      if (inUse) {
        toast('🚫 المصدر مرتبط بمعاملات دخل — لا يمكن حذفه', 'error');
        return;
      }
      const ok = await confirmDialog({
        title: 'حذف المصدر',
        message: `هل تريد حذف المصدر "${src?.name || ''}"؟`,
        icon: '💼',
      });
      if (!ok) return;
      try { await deleteDoc(sourceDoc(id)); toast('تم الحذف', 'info', '🗑️'); }
      catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
    }
  };
}

function sourcesSignature() {
  return state.sources.map(s => `${s.id}:${s.name}:${s.icon}:${s.color}`).join('|');
}

// ── Expense modal — envelope picker + live balance info ──
function setupExpenseEnvelopePicker() {
  const sel  = document.getElementById('f-exp-envelope');
  if (!sel) return;
  if (state.envelopes.length === 0) {
    sel.innerHTML = `<option value="">⚠️ أنشئ ظرف أولاً</option>`;
  } else {
    sel.innerHTML = state.envelopes.map(e =>
      `<option value="${e.id}">${escapeHtml(e.icon || '📂')} ${escapeHtml(e.name)}</option>`
    ).join('');
  }
  sel.addEventListener('change', refreshExpenseEnvelopeInfo);
  const amt = document.getElementById('f-exp-amount');
  if (amt) amt.addEventListener('input', refreshExpenseEnvelopeInfo);
  refreshExpenseEnvelopeInfo();
}

function refreshExpenseEnvelopeInfo() {
  const sel  = document.getElementById('f-exp-envelope');
  const info = document.getElementById('exp-envelope-info');
  const amtEl = document.getElementById('f-exp-amount');
  if (!sel || !info) return;
  const envId = sel.value;
  if (!envId) {
    info.textContent = 'اختر ظرف لمعرفة الرصيد المتاح';
    info.classList.remove('is-warn', 'is-error');
    return;
  }
  const excludeId = state.editTarget?.type === 'expense' ? state.editTarget.id : null;
  const bal = computeEnvelopeBalance(envId, excludeId);
  const amt = Number(amtEl?.value) || 0;
  info.textContent = `الرصيد المتاح: ${formatMoney(bal)} ج.م${amt > 0 ? ' — بعد العملية: ' + formatMoney(bal - amt) : ''}`;
  info.classList.remove('is-warn', 'is-error');
  if (amt > 0 && amt > bal + 0.005) {
    info.textContent += ' — ⛔ غير كافٍ، اعمل تحويل من ظرف تاني';
    info.classList.add('is-error');
  } else if (amt > 0 && bal - amt < bal * 0.15) {
    info.classList.add('is-warn');
  }
}

// ── Transfer modal — from/to pickers + live balance info ──
function setupTransferPickers() {
  const fSel = document.getElementById('f-tr-from');
  const tSel = document.getElementById('f-tr-to');
  if (!fSel || !tSel) return;
  const opts = state.envelopes.map(e =>
    `<option value="${e.id}">${escapeHtml(e.icon || '📂')} ${escapeHtml(e.name)}</option>`
  ).join('');
  if (state.envelopes.length < 2) {
    fSel.innerHTML = `<option value="">⚠️ تحتاج ظرفين على الأقل</option>`;
    tSel.innerHTML = `<option value="">⚠️ تحتاج ظرفين على الأقل</option>`;
  } else {
    fSel.innerHTML = opts;
    tSel.innerHTML = opts;
    if (state.envelopes.length >= 2) tSel.selectedIndex = 1;
  }
  fSel.addEventListener('change', refreshTransferInfo);
  tSel.addEventListener('change', refreshTransferInfo);
  const amt = document.getElementById('f-tr-amount');
  if (amt) amt.addEventListener('input', refreshTransferInfo);
  refreshTransferInfo();
}

function refreshTransferInfo() {
  const fSel = document.getElementById('f-tr-from');
  const info = document.getElementById('tr-from-info');
  const amtEl = document.getElementById('f-tr-amount');
  if (!fSel || !info) return;
  const envId = fSel.value;
  if (!envId) {
    info.textContent = 'اختر الظرف المصدر';
    info.classList.remove('is-warn', 'is-error');
    return;
  }
  const excludeId = state.editTarget?.type === 'transfer' ? state.editTarget.id : null;
  const bal = computeEnvelopeBalance(envId, null, excludeId);
  const amt = Number(amtEl?.value) || 0;
  info.textContent = `رصيد المصدر: ${formatMoney(bal)} ج.م${amt > 0 ? ' — بعد التحويل: ' + formatMoney(bal - amt) : ''}`;
  info.classList.remove('is-warn', 'is-error');
  if (amt > 0 && amt > bal + 0.005) {
    info.textContent += ' — ⛔ غير كافٍ';
    info.classList.add('is-error');
  }
}

// ── Allocation modal — forced 100% distribution UI ──
function setupAllocationModal() {
  const id  = state.editTarget?.id;
  let inc = state.incomes.find(i => i.id === id);
  // Newly-created incomes can arrive on the snapshot after openModal runs.
  // Poll a few frames before giving up so the freshly-saved doc shows up.
  if (!inc) {
    let attempts = 0;
    const retry = () => {
      attempts++;
      inc = state.incomes.find(i => i.id === id);
      if (inc) { setupAllocationModal(); return; }
      if (attempts < 10) return void setTimeout(retry, 80);
      toast('الدخل غير موجود', 'error');
      closeModal();
    };
    setTimeout(retry, 80);
    return;
  }
  const list = document.getElementById('alloc-envelopes-list');
  if (!list) return;

  if (state.envelopes.length === 0) {
    list.innerHTML = `
      <div class="finance-empty">
        <span class="finance-empty-icon">⚠️</span>
        <span class="finance-empty-text">لا يوجد أظرف</span>
        <span class="finance-empty-sub">اقفل الـ modal وأضف أظرف الأول</span>
      </div>`;
    document.getElementById('alloc-amount-total').textContent = formatMoney(inc.amount);
    document.getElementById('alloc-amount-done').textContent = '0';
    return;
  }

  // Pre-existing allocations (when re-opening an already-allocated income)
  const existing = inc.allocations || {};

  list.innerHTML = state.envelopes.map(env => {
    const cur = Number(existing[env.id]) || 0;
    const bal = computeEnvelopeBalance(env.id);
    return `
      <div class="alloc-env-row ${cur > 0 ? 'has-value' : ''}" data-env="${env.id}">
        <span class="alloc-env-icon">${escapeHtml(env.icon || '📂')}</span>
        <div class="alloc-env-body">
          <div class="alloc-env-name">${escapeHtml(env.name)}</div>
          <div class="alloc-env-balance">رصيد حالي: ${formatMoney(bal)}</div>
        </div>
        <input type="number" class="alloc-env-input" step="0.01" min="0"
          placeholder="0" value="${cur || ''}" data-envelope-id="${env.id}" />
      </div>`;
  }).join('');

  // Add an "وزّع الباقي على هذا الظرف" quick button via input focus? Simpler: keyboard helper.
  document.getElementById('alloc-amount-total').textContent = formatMoney(inc.amount);
  refreshAllocationProgress();

  list.addEventListener('input', refreshAllocationProgress);
  // Highlight row when value present
  list.addEventListener('input', (e) => {
    const inp = e.target.closest('.alloc-env-input');
    if (!inp) return;
    inp.closest('.alloc-env-row')?.classList.toggle('has-value', Number(inp.value) > 0);
  });
}

function refreshAllocationProgress() {
  const id  = state.editTarget?.id;
  const inc = state.incomes.find(i => i.id === id);
  if (!inc) return;
  const inputs = document.querySelectorAll('#alloc-envelopes-list .alloc-env-input');
  let sum = 0;
  inputs.forEach(inp => { sum += Number(inp.value) || 0; });

  const wrap   = document.getElementById('alloc-progress');
  const fill   = document.getElementById('alloc-progress-fill');
  const status = document.getElementById('alloc-progress-status');
  const doneEl = document.getElementById('alloc-amount-done');
  doneEl.textContent = formatMoney(sum);

  const pct = inc.amount > 0 ? (sum / inc.amount) * 100 : 0;
  fill.style.width = Math.min(pct, 100) + '%';

  const delta = sum - inc.amount;
  let mode = 'empty';
  let msg  = 'ابدأ التوزيع — لا يمكن الحفظ قبل الوصول لـ 100%';
  if (sum === 0) { mode = 'empty'; msg = 'لم يتم توزيع شيء بعد — وزِّع المبلغ كاملاً'; }
  else if (Math.abs(delta) <= 0.005) { mode = 'complete'; msg = '✅ التوزيع 100% مكتمل — اضغط تأكيد'; }
  else if (delta < 0) { mode = 'partial'; msg = `متبقي للتوزيع: ${formatMoney(-delta)} ج.م`; }
  else { mode = 'over'; msg = `⛔ زاد عن المبلغ بـ ${formatMoney(delta)} ج.م`; }

  wrap.classList.remove('is-empty', 'is-partial', 'is-complete', 'is-over');
  wrap.classList.add('is-' + mode);
  status.textContent = msg;

  // Submit button: enabled only when complete
  const btn = document.getElementById('modal-submit-btn');
  if (btn) {
    const blocked = mode !== 'complete';
    btn.disabled = blocked;
    btn.classList.toggle('is-blocked', blocked);
    btn.textContent = blocked ? '🔒 يلزم 100%' : 'تأكيد التوزيع';
  }
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
          if (tid === state.draggedId && isStatusChange) {
            update.status = status;
            if (status === 'done') update.completedAt = serverTimestamp();
          }
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
      <!-- v28.0 — Pricing moved to Finance Hub. Project modal stays
           money-free; configure hourly rate / fixed price when adding a
           freelance income source inside المركز المالي. -->
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
  envelope: {
    title:      '📂 إضافة ظرف جديد',
    submitText: 'إنشاء الظرف',
    fields: `
      <div class="form-group">
        <label class="form-label">اسم الظرف <span class="required">*</span></label>
        <input type="text" id="f-env-name" class="form-input"
          placeholder="مثال: مصاريف الجواز" maxlength="60" required />
      </div>
      <div class="form-group">
        <label class="form-label">أيقونة (إيموجي)</label>
        <input type="text" id="f-env-icon" class="form-input"
          placeholder="📂  أو أي إيموجي" maxlength="4" />
      </div>
      <div class="form-group">
        <label class="form-label">اللون</label>
        <div class="color-swatch-row" id="f-env-color-row" data-target="f-env-color"></div>
        <input type="hidden" id="f-env-color" value="#3574F0" />
      </div>`,
  },
  source: {
    title:      '💼 إضافة مصدر دخل',
    submitText: 'حفظ المصدر',
    fields: `
      <div class="form-group">
        <label class="form-label">اسم المصدر <span class="required">*</span></label>
        <input type="text" id="f-src-name" class="form-input"
          placeholder="مثال: شركة النور، مشروع X" maxlength="60" required />
      </div>
      <div class="form-group">
        <label class="form-label">أيقونة (إيموجي)</label>
        <input type="text" id="f-src-icon" class="form-input"
          placeholder="🏢  أو 💻 أو 🚀..." maxlength="4" />
      </div>
      <div class="form-group">
        <label class="form-label">اللون</label>
        <div class="color-swatch-row" id="f-src-color-row" data-target="f-src-color"></div>
        <input type="hidden" id="f-src-color" value="#3574F0" />
      </div>`,
  },
  sources_manage: {
    title:      '⚙️ إدارة مصادر الدخل',
    submitText: 'إغلاق',
    fields: `
      <div class="manage-list-wrap">
        <div class="manage-list" id="sources-manage-list"></div>
        <button type="button" class="btn-secondary manage-add-btn" id="sources-manage-add">+ إضافة مصدر جديد</button>
      </div>`,
  },
  income: {
    title:      '💼 تسجيل دخل',
    submitText: 'حفظ — ثم وزِّع',
    fields: `
      <div class="form-group" style="display:flex; gap:10px;">
        <div style="flex:1;">
          <label class="form-label">المبلغ <span class="required">*</span></label>
          <input type="number" id="f-inc-amount" class="form-input" step="0.01" min="0"
            placeholder="0" required />
        </div>
        <div style="flex:1;">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input type="date" id="f-inc-date" class="form-input" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">المصدر <span class="required">*</span>
          <button type="button" class="form-label-action" id="f-inc-manage-sources">⚙️ إدارة المصادر</button>
        </label>
        <select id="f-inc-source" class="form-select" required></select>
      </div>
      <div class="form-group">
        <label class="form-label">نوع الدفعة <span class="required">*</span></label>
        <select id="f-inc-paytype" class="form-select" required>
          <option value="salary">💰 مرتب</option>
          <option value="project_advance">📥 مقدم مشروع</option>
          <option value="project_payment">💵 دفعة من مشروع</option>
          <option value="project_final">✅ نهاية مشروع</option>
          <option value="adjustment">⚙️ فلوس تعديل</option>
          <option value="other">📝 أخرى</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">ملاحظات (اختياري)</label>
        <textarea id="f-inc-notes" class="form-textarea"
          placeholder="تفاصيل إضافية أو تفاصيل المشروع..." maxlength="240"></textarea>
      </div>
      <small style="display:block; margin-top:-4px; color:var(--text-muted); font-size:11.5px; line-height:1.6;">
        ⚠️ بعد الحفظ هتظهر شاشة توزيع إجبارية. الفلوس مش هتتاحلك للصرف لحد ما توزعها 100% على الأظرف.
      </small>`,
  },
  allocate: {
    title:      '🎯 توزيع الدخل على الأظرف',
    submitText: 'تأكيد التوزيع',
    fields: `
      <div class="alloc-progress-wrap" id="alloc-progress">
        <div class="alloc-progress-head">
          <span>إجمالي الموزَّع</span>
          <span><span class="alloc-progress-amount" id="alloc-amount-done">0</span>
            / <span class="alloc-progress-amount" id="alloc-amount-total">0</span></span>
        </div>
        <div class="alloc-progress-bar">
          <div class="alloc-progress-fill" id="alloc-progress-fill"></div>
        </div>
        <div class="alloc-progress-status" id="alloc-progress-status">ابدأ التوزيع — لا يمكن الحفظ قبل الوصول لـ 100%</div>
      </div>
      <div class="alloc-envelopes-list" id="alloc-envelopes-list">
        <!-- envelope inputs rendered dynamically -->
      </div>`,
  },
  expense: {
    title:      '💸 تسجيل مصروف',
    submitText: 'تسجيل المصروف',
    fields: `
      <div class="form-group" style="display:flex; gap:10px;">
        <div style="flex:1;">
          <label class="form-label">المبلغ <span class="required">*</span></label>
          <input type="number" id="f-exp-amount" class="form-input" step="0.01" min="0"
            placeholder="0" required />
        </div>
        <div style="flex:1;">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input type="date" id="f-exp-date" class="form-input" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">الظرف <span class="required">*</span></label>
        <select id="f-exp-envelope" class="form-select" required>
          <!-- populated dynamically -->
        </select>
        <div class="exp-envelope-info" id="exp-envelope-info">اختر ظرف لمعرفة الرصيد المتاح</div>
      </div>
      <div class="form-group">
        <label class="form-label">بيان المصروف (اختياري)</label>
        <input type="text" id="f-exp-note" class="form-input"
          placeholder="مثال: عشاء العيلة" maxlength="100" />
      </div>`,
  },
  transfer: {
    title:      '↔ تحويل بين الأظرف',
    submitText: 'تنفيذ التحويل',
    fields: `
      <div class="form-group">
        <label class="form-label">من → إلى <span class="required">*</span></label>
        <div class="tr-arrow-row">
          <select id="f-tr-from" class="form-select" required></select>
          <span class="tr-arrow">←</span>
          <select id="f-tr-to" class="form-select" required></select>
        </div>
        <div class="exp-envelope-info" id="tr-from-info">اختر الظرف المصدر</div>
      </div>
      <div class="form-group" style="display:flex; gap:10px;">
        <div style="flex:1;">
          <label class="form-label">المبلغ <span class="required">*</span></label>
          <input type="number" id="f-tr-amount" class="form-input" step="0.01" min="0"
            placeholder="0" required />
        </div>
        <div style="flex:1;">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input type="date" id="f-tr-date" class="form-input" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">السبب (اختياري)</label>
        <input type="text" id="f-tr-note" class="form-input"
          placeholder="مثال: الرفاهية خلصت ومحتاج أنقل من الطوارئ" maxlength="120" />
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

  if (type === 'income') {
    if (!state.editTarget) {
      const d = document.getElementById('f-inc-date');
      if (d) d.value = toLocalISODate(new Date());
    }
    setupIncomeSourcePicker();
  }

  if (type === 'expense') {
    if (!state.editTarget) {
      const d = document.getElementById('f-exp-date');
      if (d) d.value = toLocalISODate(new Date());
    }
    setupExpenseEnvelopePicker();
  }

  if (type === 'transfer') {
    if (!state.editTarget) {
      const d = document.getElementById('f-tr-date');
      if (d) d.value = toLocalISODate(new Date());
    }
    setupTransferPickers();
  }

  if (type === 'allocate') {
    setupAllocationModal();
  }

  if (type === 'envelope') {
    setupColorSwatchRow('f-env-color-row');
  }

  if (type === 'source') {
    setupColorSwatchRow('f-src-color-row');
  }

  if (type === 'sources_manage') {
    setupSourcesManageModal();
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

    // v28.0 — Pricing fields no longer rendered in the project modal.
    // Existing pricing data on the doc is preserved untouched on save.

    // Prefill quick links
    const linksList = document.getElementById('proj-links-list');
    if (linksList && Array.isArray(project.links)) {
      linksList.innerHTML = project.links.map(l => projLinkRowHTML(l.label, l.url)).join('');
    }

  } else if (type === 'envelope') {
    const env = state.envelopes.find(e => e.id === id);
    if (!env) return;
    document.getElementById('f-env-name').value = env.name || '';
    document.getElementById('f-env-icon').value = env.icon || '';
    const colorEl = document.getElementById('f-env-color');
    if (colorEl && env.color) { colorEl.value = env.color; setupColorSwatchRow('f-env-color-row'); }

  } else if (type === 'source') {
    const src = state.sources.find(s => s.id === id);
    if (!src) return;
    document.getElementById('f-src-name').value = src.name || '';
    document.getElementById('f-src-icon').value = src.icon || '';
    const colorEl = document.getElementById('f-src-color');
    if (colorEl && src.color) { colorEl.value = src.color; setupColorSwatchRow('f-src-color-row'); }

  } else if (type === 'income') {
    const inc = state.incomes.find(x => x.id === id);
    if (!inc) return;
    document.getElementById('f-inc-amount').value  = inc.amount ?? '';
    const d = parseDateField(inc.date);
    document.getElementById('f-inc-date').value    = toLocalISODate(d || new Date());
    const srcSel = document.getElementById('f-inc-source');
    if (srcSel && inc.source) {
      // The source dropdown may not yet include the income's source if it was
      // deleted. Surface it explicitly so the user can see what's selected.
      const exists = [...srcSel.options].some(o => o.value === inc.source);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = inc.source;
        opt.textContent = '❔ مصدر محذوف';
        srcSel.appendChild(opt);
      }
      srcSel.value = inc.source;
    }
    document.getElementById('f-inc-paytype').value = inc.paymentType || 'salary';
    const nEl = document.getElementById('f-inc-notes');
    if (nEl) nEl.value = inc.notes || '';

  } else if (type === 'expense') {
    const ex = state.expenses.find(x => x.id === id);
    if (!ex) return;
    document.getElementById('f-exp-amount').value = ex.amount ?? '';
    const d = parseDateField(ex.date);
    document.getElementById('f-exp-date').value   = toLocalISODate(d || new Date());
    const eSel = document.getElementById('f-exp-envelope');
    if (eSel && ex.envelopeId) eSel.value = ex.envelopeId;
    document.getElementById('f-exp-note').value   = ex.note || '';
    refreshExpenseEnvelopeInfo();

  } else if (type === 'transfer') {
    const tr = state.transfers.find(x => x.id === id);
    if (!tr) return;
    document.getElementById('f-tr-amount').value = tr.amount ?? '';
    const d = parseDateField(tr.date);
    document.getElementById('f-tr-date').value   = toLocalISODate(d || new Date());
    const fSel = document.getElementById('f-tr-from');
    const tSel = document.getElementById('f-tr-to');
    if (fSel && tr.fromEnvelopeId) fSel.value = tr.fromEnvelopeId;
    if (tSel && tr.toEnvelopeId)   tSel.value = tr.toEnvelopeId;
    document.getElementById('f-tr-note').value   = tr.note || '';
    refreshTransferInfo();

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

      // v28.0 — Pricing fields are not part of the project modal anymore.
      // We preserve any existing values on the doc by omitting them from
      // the update payload (Firestore update() leaves untouched fields).
      const links = collectProjectLinks();

      const payload = {
        name, description: desc || null, status, links,
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

    } else if (currentModalType === 'envelope') {
      const name = document.getElementById('f-env-name').value.trim();
      const icon = document.getElementById('f-env-icon').value.trim() || '📂';
      const color = document.getElementById('f-env-color').value || '#3574F0';
      if (!name) { toast('يرجى إدخال اسم الظرف', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      const payload = { name, icon, color };
      if (state.editTarget) {
        await updateDoc(envelopeDoc(state.editTarget.id), payload);
        toast('تم تعديل الظرف', 'success');
      } else {
        const maxOrder = state.envelopes.reduce((m, e) =>
          (typeof e.sortOrder === 'number' && e.sortOrder > m) ? e.sortOrder : m, -1);
        await addDoc(envelopesRef(), {
          ...payload,
          sortOrder: maxOrder + 1,
          createdAt: serverTimestamp(),
        });
        toast('تم إنشاء الظرف', 'success', '📂');
      }
      closeModal();

    } else if (currentModalType === 'source') {
      const name  = document.getElementById('f-src-name').value.trim();
      const icon  = document.getElementById('f-src-icon').value.trim() || '💼';
      const color = document.getElementById('f-src-color').value || '#3574F0';
      if (!name) { toast('يرجى إدخال اسم المصدر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      const payload = { name, icon, color };
      if (state.editTarget) {
        await updateDoc(sourceDoc(state.editTarget.id), payload);
        toast('تم تعديل المصدر', 'success');
      } else {
        const maxOrder = state.sources.reduce((m, s) =>
          (typeof s.sortOrder === 'number' && s.sortOrder > m) ? s.sortOrder : m, -1);
        await addDoc(sourcesRef(), {
          ...payload,
          sortOrder: maxOrder + 1,
          createdAt: serverTimestamp(),
        });
        toast('تمت إضافة المصدر', 'success', '💼');
      }
      closeModal();

    } else if (currentModalType === 'sources_manage') {
      // Manage modal "submit" just closes — list mutations happen inline.
      closeModal();

    } else if (currentModalType === 'income') {
      const amount  = Number(document.getElementById('f-inc-amount').value);
      const dateStr = document.getElementById('f-inc-date').value;
      const source  = document.getElementById('f-inc-source').value;
      const paymentType = document.getElementById('f-inc-paytype').value;
      const notes   = document.getElementById('f-inc-notes')?.value.trim() || null;
      if (!(amount > 0)) { toast('المبلغ يجب أن يكون أكبر من صفر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!dateStr)      { toast('يرجى تحديد التاريخ', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      const date = fromLocalISODate(dateStr);

      const payload = { amount, source, paymentType, notes, date };
      if (state.editTarget) {
        // Editing keeps the allocation state untouched
        await updateDoc(incomeDoc(state.editTarget.id), payload);
        toast('تم تعديل الدخل', 'success');
        closeModal();
      } else {
        // New incomes are frozen (allocated:false) until the user distributes 100%
        const ref = await addDoc(incomesRef(), {
          ...payload,
          allocated: false,
          allocations: {},
          createdAt: serverTimestamp(),
        });
        toast('تم تسجيل الدخل — وزِّعه على الأظرف', 'success', '💼');
        closeModal();
        // Immediately open the forced allocation modal for the new doc
        openModal('allocate', ref.id);
      }

    } else if (currentModalType === 'allocate') {
      // Allocation modal — collect per-envelope amounts, must sum to 100% of income
      const incomeId = state.editTarget?.id;
      const inc = state.incomes.find(i => i.id === incomeId);
      if (!inc) { toast('الدخل غير موجود', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      const inputs = document.querySelectorAll('#alloc-envelopes-list .alloc-env-input');
      const allocations = {};
      let sum = 0;
      inputs.forEach(inp => {
        const v = Number(inp.value) || 0;
        if (v > 0) { allocations[inp.dataset.envelopeId] = v; sum += v; }
      });
      const delta = Math.abs(sum - inc.amount);
      if (delta > 0.005) {
        toast('يجب توزيع 100% من المبلغ بالضبط', 'error');
        btn.disabled = false; btn.textContent = orig; return;
      }
      await updateDoc(incomeDoc(incomeId), { allocated: true, allocations });
      toast('تم التوزيع — الأموال متاحة الآن في الأظرف', 'success', '✅');
      closeModal();

    } else if (currentModalType === 'expense') {
      const amount = Number(document.getElementById('f-exp-amount').value);
      const dateStr = document.getElementById('f-exp-date').value;
      const envelopeId = document.getElementById('f-exp-envelope').value || null;
      const note = document.getElementById('f-exp-note').value.trim() || null;
      if (!(amount > 0)) { toast('المبلغ يجب أن يكون أكبر من صفر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!envelopeId)   { toast('اختر ظرف أولاً', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!dateStr)      { toast('يرجى تحديد التاريخ', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      // Behavioural enforcement: block if envelope can't cover the spend.
      // On edit, exclude the current expense from the balance calculation.
      const excludeId = state.editTarget ? state.editTarget.id : null;
      const balance = computeEnvelopeBalance(envelopeId, excludeId);
      if (amount > balance + 0.005) {
        toast(`🚫 الرصيد في الظرف (${formatMoney(balance)}) أقل من المبلغ — اعمل تحويل من ظرف تاني الأول`, 'error');
        btn.disabled = false; btn.textContent = orig; return;
      }

      const date = fromLocalISODate(dateStr);
      const payload = { amount, envelopeId, note, date };
      if (state.editTarget) {
        await updateDoc(expenseDoc(state.editTarget.id), payload);
        toast('تم تعديل المصروف', 'success');
      } else {
        await addDoc(expensesRef(), { ...payload, createdAt: serverTimestamp() });
        toast('تم تسجيل المصروف', 'success', '💸');
      }
      closeModal();

    } else if (currentModalType === 'transfer') {
      const amount  = Number(document.getElementById('f-tr-amount').value);
      const dateStr = document.getElementById('f-tr-date').value;
      const fromEnvelopeId = document.getElementById('f-tr-from').value || null;
      const toEnvelopeId   = document.getElementById('f-tr-to').value   || null;
      const note    = document.getElementById('f-tr-note').value.trim() || null;
      if (!(amount > 0))       { toast('المبلغ يجب أن يكون أكبر من صفر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!fromEnvelopeId)     { toast('اختر الظرف المصدر', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!toEnvelopeId)       { toast('اختر الظرف الهدف', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (fromEnvelopeId === toEnvelopeId) { toast('الظرفين لازم يكونوا مختلفين', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!dateStr)            { toast('يرجى تحديد التاريخ', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      const excludeId = state.editTarget ? state.editTarget.id : null;
      const fromBalance = computeEnvelopeBalance(fromEnvelopeId, null, excludeId);
      if (amount > fromBalance + 0.005) {
        toast(`🚫 الرصيد في الظرف المصدر (${formatMoney(fromBalance)}) أقل من المبلغ`, 'error');
        btn.disabled = false; btn.textContent = orig; return;
      }
      const date = fromLocalISODate(dateStr);
      const payload = { amount, fromEnvelopeId, toEnvelopeId, note, date };
      if (state.editTarget) {
        await updateDoc(transferDoc(state.editTarget.id), payload);
        toast('تم تعديل التحويل', 'success');
      } else {
        await addDoc(transfersRef(), { ...payload, createdAt: serverTimestamp() });
        toast('تم التحويل', 'success', '↔');
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

// v28.0 — Promise-based custom confirm modal. Used by Finance Hub deletes
// so we never fall back to the browser's native window.confirm.
function confirmDialog({ title = 'تأكيد', message = 'هل أنت متأكد؟', icon = '🗑️', confirmText = 'تأكيد الحذف' } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('async-confirm-overlay');
    if (!overlay) { resolve(window.confirm(message)); return; }
    document.getElementById('async-confirm-title').textContent   = title;
    document.getElementById('async-confirm-message').textContent = message;
    document.getElementById('async-confirm-icon').textContent    = icon;
    const yes = document.getElementById('async-confirm-yes');
    const no  = document.getElementById('async-confirm-no');
    yes.textContent = confirmText;

    let done = false;
    const cleanup = (val) => {
      if (done) return; done = true;
      overlay.classList.add('hidden');
      yes.removeEventListener('click', onYes);
      no .removeEventListener('click', onNo);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onYes      = () => cleanup(true);
    const onNo       = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
    const onKey      = (e) => { if (e.key === 'Escape') cleanup(false); };

    yes.addEventListener('click', onYes);
    no .addEventListener('click', onNo);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    overlay.classList.remove('hidden');
    setTimeout(() => no.focus(), 50);
  });
}

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

// (removed) Periodic full re-render every 60s used to refresh relative
// timestamps, but caused a visible flicker. Firestore onSnapshot listeners
// already keep data live; relative timestamps will simply recompute on the
// next snapshot or user navigation.

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
  // Mirror to Firestore so the nightly report can sum today's focus per project.
  // Fire-and-forget — local UX must not wait on the network.
  addDoc(focusSessionsRef(), {
    projectId,
    minutes,
    hours,
    day: _todayKey(),
    at: serverTimestamp(),
  }).catch(err => console.warn('focusSessions mirror failed', err));
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


