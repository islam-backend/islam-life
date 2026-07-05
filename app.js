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
  getDoc,
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
    // Check if the authenticated user matches the allowed email AND has a
    // verified email — mirrors the server-side Firestore rule so the client
    // never shows the app shell to an unverified/unauthorized account.
    if (user.email === allowedEmail && user.emailVerified) {
      if (loginScreen) loginScreen.classList.add('hidden');
      if (loadingOverlay) loadingOverlay.classList.add('hidden');

      if (!isBooted) {
        setupColumnDnD();
        navigateTo('dashboard');
        isBooted = true;
      }
    } else {
      // Sign out and display error — distinguish the unverified-email case so
      // the right person knows to check their inbox vs. switch accounts.
      const unverified = user.email === allowedEmail && !user.emailVerified;
      await signOut(auth);
      showLoginError(unverified
        ? '❌ يجب تفعيل البريد الإلكتروني أولاً. راجع رسالة التفعيل في بريدك ثم حاول مجدداً.'
        : '❌ عذراً، هذا الحساب غير مصرح له بالدخول. يرجى تسجيل الدخول بحساب المدير.');
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

    // Hide main screen, show login screen
    if (loginScreen) loginScreen.classList.remove('hidden');
    hideLoading(); // Remove DB spinner if still there
    resetLoginButton(); // Re-enable the button (covers rejected-account signOut)
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
// Snapshot the pristine button markup so we can always restore it — including
// when the popup succeeds but onAuthStateChanged rejects the account (the catch
// below never runs in that case, which used to leave the button stuck disabled).
const googleLoginBtnHTML = googleLoginBtn ? googleLoginBtn.innerHTML : '';
function resetLoginButton() {
  const b = document.getElementById('google-login-btn');
  if (!b) return;
  b.disabled = false;
  b.innerHTML = googleLoginBtnHTML;
}

// Map common Firebase auth errors to clear Arabic guidance.
function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'تم إغلاق نافذة جوجل قبل إكمال الدخول. حاول مرة أخرى.';
    case 'auth/popup-blocked':
      return 'المتصفح منع النافذة المنبثقة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مجدداً.';
    case 'auth/unauthorized-domain':
      return 'هذا النطاق غير مصرّح به في Firebase. أضِفه من Authentication → Settings → Authorized domains.';
    case 'auth/network-request-failed':
      return 'فشل الاتصال بالشبكة. تحقق من الإنترنت وحاول مجدداً.';
    default:
      return `فشل تسجيل الدخول: ${err?.message || 'يرجى المحاولة مجدداً'}`;
  }
}

if (googleLoginBtn) {
  googleLoginBtn.addEventListener('click', async () => {
    googleLoginBtn.disabled = true;
    googleLoginBtn.innerHTML = `<span>🔄 جاري الاتصال بجوجل...</span>`;

    const errBox = document.getElementById('login-error');
    if (errBox) errBox.classList.add('hidden');

    try {
      await signInWithPopup(auth, provider);
      // On success, onAuthStateChanged takes over (hides login or rejects +
      // resets the button). Nothing else to do here.
    } catch (err) {
      console.error('Sign-in failed:', err);
      showLoginError('❌ ' + authErrorMessage(err));
      resetLoginButton();
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

if (navDashboard) {
  navDashboard.addEventListener('click', () => navigateTo('dashboard'));
}
if (navClients) {
  navClients.addEventListener('click', () => navigateTo('clients'));
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
const btnBackClients = document.getElementById('btn-back-clients');
if (btnBackClients) {
  btnBackClients.addEventListener('click', () => navigateTo('dashboard'));
}
const btnClientsCalendar = document.getElementById('btn-clients-calendar');
if (btnClientsCalendar) {
  btnClientsCalendar.addEventListener('click', () => navigateTo('calendar'));
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
    if (state.navigationSource === 'day') {
      navigateTo('day', { date: state.dayDate || new Date() });
    } else if (state.navigationSource === 'daily') {
      navigateTo('daily');
    } else if (state.navigationSource === 'dashboard') {
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

// ── Finance Hub Refs (المركز المالي) ──────────────────────────
const banksRef         = ()      => collection(db, 'banks');
const envelopesRef     = ()      => collection(db, 'envelopes');
const transactionsRef  = ()      => collection(db, 'transactions');
const goldAssetsRef    = ()      => collection(db, 'gold_assets');
const bankDoc          = (id)    => doc(db, 'banks', id);
const envelopeDoc      = (id)    => doc(db, 'envelopes', id);
const goldAssetDoc     = (id)    => doc(db, 'gold_assets', id);
const transactionDoc   = (id)    => doc(db, 'transactions', id);
const allocRuleDoc     = (type)  => doc(db, 'allocation_rules', type);   // type: 'salary' | 'freelance'
const goldPricesDoc    = ()      => doc(db, 'meta', 'goldPrices');
const liabilitiesRef   = ()      => collection(db, 'liabilities');
const liabilityDoc     = (id)    => doc(db, 'liabilities', id);
const finSettingsDoc   = ()      => doc(db, 'meta', 'finSettings');       // { unallocatedEnvelopeId }

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
  pendingHighlightTaskId: null,   // v23.0 — scroll-to-task after kanban opens
  // Calendar state (v9.2)
  calendarCursor:       null,     // Date pointing at the displayed month
  dayDate:              null,     // Date selected for day-details view
  // Finance Hub state (المركز المالي)
  banks:        [],
  envelopes:    [],
  transactions: [],
  goldAssets:   [],
  allocRules:   { salary: [], freelance: [] },
  goldPrices:   null,            // { p24, p21, p18, source, updatedAt }
  finUnsub:     [],              // array of onSnapshot unsubscribers
  pendingIncomeTxId: null,       // normal-income tx awaiting forced allocation
  pendingIncomeAmount: 0,
  envelope:       null,          // currently open envelope detail
  bank:           null,          // currently open bank detail
  finFilter:      { type: 'all', from: null, to: null },
  finBankFilter:  { type: 'all', from: null, to: null },
  finEnvFilter:   { type: 'all' },
  liabilities:    [],            // debts / installments (وحدة الالتزامات)
  finSettings:    { unallocatedEnvelopeId: null },  // صائد الكسور destination
  finPeriod:      finThisPeriod(),  // selected month key 'YYYY-MM' (الفصل الشهري)
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
  (state.finUnsub || []).forEach(safeUnsub); state.finUnsub = [];
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
//  HUB (Home launcher) — scalable module registry
// ════════════════════════════════════════════════════════════════
// Add a new section = add one entry here + create its view + wire it.
// The hub grid renders itself from this array, so it never overflows.
const MODULES = [
  { id: 'clients',  title: 'العملاء', icon: '👥', view: 'clients' },
  { id: 'finance',  title: 'المركز المالي', icon: '💰', view: 'finance' },
];

function renderHub() {
  const grid = document.getElementById('hub-grid');
  if (!grid) return;
  grid.innerHTML = MODULES.map(m => `
    <button class="hub-tile" type="button" data-view="${m.view}" aria-label="${escapeHtml(m.title)}">
      <span class="hub-tile-icon" aria-hidden="true">${m.icon}</span>
      <span class="hub-tile-title">${escapeHtml(m.title)}</span>
      <svg class="hub-tile-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>`).join('');
  grid.querySelectorAll('.hub-tile').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.view));
  });
}

// ════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════

// In-memory nav history so the browser Back gesture (mouse back button,
// touchpad two-finger swipe) can restore a previous view with its live
// payload objects (which can't be serialized into history state).
const navStack = [];

function navigateTo(view, payload = {}, fromPop = false) {
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
    if (payload.fromDay) {
      state.navigationSource = 'day';
    } else if (payload.fromDaily) {
      state.navigationSource = 'daily';
    } else if (payload.fromDashboard) {
      state.navigationSource = 'dashboard';
    } else if (payload.fromProjectsAll) {
      state.navigationSource = 'projects-all';
    } else {
      state.navigationSource = 'clients';
    }
  }

  // Update sidebar nav active states
  const showDashActive    = (view === 'dashboard') || (view === 'daily') || (view === 'tasks' && state.navigationSource === 'dashboard');
  const showClientsActive = (view === 'clients') || (view === 'projects' && state.client) || (view === 'tasks' && state.navigationSource === 'clients');

  document.getElementById('nav-dashboard')?.classList.toggle('active', !!showDashActive);
  document.getElementById('nav-clients')?.classList.toggle('active', !!showClientsActive);

  // Hide all views, show target
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  try {
  if (view === 'dashboard') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-dashboard').classList.add('active');
    renderHub();
    loadPrayerTimes();
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

  } else if (view === 'tasks') {
    if (payload.client)  state.client  = payload.client;
    if (payload.project) state.project = payload.project;
    document.getElementById('view-tasks').classList.add('active');
    subscribeTasks();

  } else if (view === 'finance') {
    state.client   = null;
    state.project  = null;
    state.envelope = null;
    document.getElementById('view-finance').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-banks') {
    state.client  = null;
    state.project = null;
    state.bank    = null;
    document.getElementById('view-finance-banks').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-bank') {
    state.client  = null;
    state.project = null;
    state.bank    = payload.bank || null;
    state.finBankFilter = { type: 'all', from: null, to: null };
    document.getElementById('view-finance-bank').classList.add('active');
    subscribeFinance();
    renderBankDetail();

  } else if (view === 'finance-envelopes') {
    state.client  = null;
    state.project = null;
    state.envelope = null;
    document.getElementById('view-finance-envelopes').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-envelope') {
    state.client  = null;
    state.project = null;
    state.envelope = payload.envelope || null;
    state.finEnvFilter = { type: 'all' };
    document.getElementById('view-finance-envelope').classList.add('active');
    subscribeFinance();
    renderEnvelopeDetail();

  } else if (view === 'finance-gold') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-finance-gold').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-liabilities') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-finance-liabilities').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-summary') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-finance-summary').classList.add('active');
    subscribeFinance();

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

  } else if (view === 'daily') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-daily').classList.add('active');
    subscribeCalendar();   // ← real-time listeners (same data as calendar/day)
    renderDailySummary();  // ← immediate render with current state
  }
  } finally {
    // Always sync the header + breadcrumb to the target view, even if a
    // subscribe/render above threw — otherwise the view switches but the
    // trail/title stay stale (e.g. the old envelope breadcrumb lingers).
    updateHeader();
    updateBreadcrumb();
  }

  // Record this step in the browser history so Back (mouse button /
  // two-finger swipe) can return here. Skip when we ARE the Back handler.
  if (!fromPop) {
    navStack.push({ view, payload });
    history.pushState({ navIdx: navStack.length - 1 }, '');
  }
}

// Back gesture → restore the previous view from our in-memory stack.
window.addEventListener('popstate', (e) => {
  const idx = e.state && typeof e.state.navIdx === 'number' ? e.state.navIdx : null;
  if (idx !== null && navStack[idx]) {
    const snap = navStack[idx];
    navigateTo(snap.view, snap.payload, true);
  } else {
    // Went back past the app's first screen → stay on the hub.
    navigateTo('dashboard', {}, true);
  }
});

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

// Time-based greeting — shown as the hub's header title.
function greetingText() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12)       return 'صباح الخير ☀️';
  else if (h >= 12 && h < 17) return 'مساء النور 🌤️';
  else if (h >= 17 && h < 22) return 'مساء الخير 🌙';
  else                        return 'ليلة هادئة ✨';
}

function renderDashboard() {
  if (state.view !== 'dashboard') return;

  // ── Welcome greeting ──
  const greetEl = document.getElementById('dash-greeting');
  if (greetEl) greetEl.textContent = greetingText();

  // ── Today's client status rings (same visual as the monthly calendar) ──
  renderTodayRings();
}

// ════════════════════════════════════════════════════════════════
//  HUB SIDE PANEL — today's client rings + prayer times
// ════════════════════════════════════════════════════════════════

// Today's clients as avatars framed by a status ring (green=all done,
// red=none done, orange=mixed) — pulled live from today's tasks.
function renderTodayRings() {
  const wrap = document.getElementById('today-rings');
  const sub  = document.getElementById('today-rings-sub');
  if (!wrap) return;

  const today      = new Date();
  const tasksToday = tasksOnDate(today);

  // Group today's tasks by (client, project) so each row is one project.
  const groups = new Map();   // key = `${cid}::${pid}`
  for (const t of tasksToday) {
    const cid = t._clientId, pid = t._projectId;
    if (!cid || !pid) continue;
    const key = `${cid}::${pid}`;
    if (!groups.has(key)) groups.set(key, { cid, pid, tasks: [] });
    groups.get(key).tasks.push(t);
  }
  const list = [...groups.values()];

  if (sub) sub.textContent = list.length ? `${list.length} مشاريع` : '';

  if (list.length === 0) {
    wrap.innerHTML = `<div class="today-rings-empty">مفيش مهام النهاردة 🎉</div>`;
    return;
  }

  wrap.innerHTML = list.map(g => {
    const c    = state.clients.find(x => x.id === g.cid);
    const p    = state.allProjects.find(x => x.id === g.pid);
    const ct   = g.tasks;
    const done = ct.filter(t => t.status === 'done').length;
    const pct  = ct.length ? Math.round((done / ct.length) * 100) : 0;
    let cls = '';
    if      (done === ct.length) cls = 'cal-avatar-done';
    else if (done === 0)         cls = 'cal-avatar-pending';
    else                         cls = 'cal-avatar-mixed';
    const inner = c?.avatarUrl
      ? `<img src="${c.avatarUrl}" alt="${escapeHtml(c.name || '')}" />`
      : escapeHtml(getInitials(c?.name || '—'));
    const bg = c?.avatarUrl ? 'transparent' : escapeHtml(c?.color || '#3574F0');
    return `
      <div class="today-ring-item" data-client-id="${g.cid}" data-project-id="${g.pid}" role="button" tabindex="0">
        <span class="cal-client-avatar ${cls}" style="background:${bg}">${inner}</span>
        <div class="today-ring-body">
          <span class="today-ring-name">${escapeHtml(p?.name || '— مشروع —')}</span>
          <span class="today-ring-client">${escapeHtml(c?.name || '')}</span>
          <div class="today-ring-bar" title="${done} من ${ct.length} خلصت">
            <div class="today-ring-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <span class="today-ring-count">${done}/${ct.length}</span>
      </div>`;
  }).join('');

  wrap.querySelectorAll('.today-ring-item').forEach(el => {
    const go = () => {
      const c = state.clients.find(x => x.id === el.dataset.clientId);
      const p = state.allProjects.find(x => x.id === el.dataset.projectId);
      if (!c || !p) return;
      // Opened from the hub → Back (button + gesture) returns to the hub.
      navigateTo('tasks', { client: c, project: p, fromDashboard: true });
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

// ── Prayer times (Aladhan API, Mansoura, Egyptian Authority method) ──
const PRAYER_CITY    = 'Mansoura';
const PRAYER_COUNTRY = 'Egypt';
const PRAYER_METHOD  = 5;   // Egyptian General Authority of Survey
const PRAYERS = [
  { key: 'Fajr',    name: 'الفجر' },
  { key: 'Dhuhr',   name: 'الظهر' },
  { key: 'Asr',     name: 'العصر' },
  { key: 'Maghrib', name: 'المغرب' },
  { key: 'Isha',    name: 'العشاء' },
];
let prayerTick = null;

// "HH:MM" (24h) → "H:MM ص/م"
function fmtPrayerTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

async function loadPrayerTimes() {
  const listEl = document.getElementById('prayer-list');
  if (!listEl) return;

  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const cacheKey = `prayerTimes:${PRAYER_CITY}:${yyyy}-${mm}-${dd}`;

  let timings = null;
  try { timings = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch {}

  if (!timings) {
    try {
      const url = `https://api.aladhan.com/v1/timingsByCity/${dd}-${mm}-${yyyy}`
        + `?city=${PRAYER_CITY}&country=${PRAYER_COUNTRY}&method=${PRAYER_METHOD}`;
      const res  = await fetch(url);
      const json = await res.json();
      timings = json?.data?.timings;
      if (timings) localStorage.setItem(cacheKey, JSON.stringify(timings));
    } catch (e) {
      console.error('prayer times fetch failed:', e);
    }
  }

  if (!timings) {
    listEl.innerHTML = `<div class="prayer-error">تعذّر تحميل المواقيت — تأكد من النت</div>`;
    return;
  }
  renderPrayerTimes(timings);
}

function renderPrayerTimes(timings) {
  const listEl = document.getElementById('prayer-list');
  const nextEl = document.getElementById('prayer-next');
  if (!listEl) return;

  const now = new Date();
  const parsed = PRAYERS.map(p => {
    const [h, m] = String(timings[p.key] || '00:00').split(':').map(Number);
    return { ...p, hhmm: timings[p.key], time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0) };
  });

  let nextIdx = parsed.findIndex(p => p.time > now);
  const isTomorrow = nextIdx === -1;   // all of today's prayers passed → next is Fajr tomorrow
  if (isTomorrow) nextIdx = 0;

  listEl.innerHTML = parsed.map((p, i) => {
    const passed = p.time <= now;                 // already prayed today
    const isNext = i === nextIdx && !isTomorrow;
    const cls = passed ? 'passed' : (isNext ? 'next' : '');
    return `
    <div class="prayer-row ${cls}">
      <span class="prayer-name">
        ${passed ? '<span class="prayer-check" aria-label="خلصت">✓</span>' : ''}${p.name}
      </span>
      <span class="prayer-time">${fmtPrayerTime(p.hhmm)}</span>
    </div>`;
  }).join('');

  if (prayerTick) clearInterval(prayerTick);
  const tick = () => {
    const nEl = document.getElementById('prayer-next');
    if (!nEl) { clearInterval(prayerTick); prayerTick = null; return; }
    const target = isTomorrow ? new Date(parsed[0].time.getTime() + 86400000) : parsed[nextIdx].time;
    const diff = target - new Date();
    if (diff <= 0) { loadPrayerTimes(); return; }   // prayer entered → refresh
    const hh = Math.floor(diff / 3600000);
    const mn = Math.floor((diff % 3600000) / 60000);
    nEl.innerHTML = `الصلاة الجاية: <b>${parsed[nextIdx].name}</b> — باقي ${hh > 0 ? hh + ' س ' : ''}${mn} د`;
  };
  tick();
  prayerTick = setInterval(tick, 30000);
}
// ════════════════════════════════════════════════════════════════
//  RENDER — DAILY SUMMARY WIDGET (v23.0)
// ════════════════════════════════════════════════════════════════

function renderDailySummary() {
  if (state.view !== 'daily') return;

  const today    = new Date();
  const todayStr = toLocalISODate(today);

  // ── Date header ──
  const dateEl = document.getElementById('daily-page-date');
  if (dateEl) {
    dateEl.textContent = today.toLocaleDateString('ar-EG', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  const todayTasks = tasksOnDate(today);

  // ── helpers ──
  function getProject(t) { return state.allProjects.find(p => p.id === t._projectId); }
  function getClient(t)  { return state.clients.find(c => c.id === t._clientId); }

  function isOverdue(t) {
    if (t.status === 'done' || t.status === 'backlog') return false;
    const ed = parseDateField(t.endDate);
    if (!ed) return false;
    return startOfDay(ed).getTime() < startOfDay(today).getTime();
  }

  function daysUntilDeadline(t) {
    const ed = parseDateField(t.endDate);
    if (!ed) return null;
    const diff = startOfDay(ed).getTime() - startOfDay(today).getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }

  const priorityLabel = { high: 'عالي', medium: 'متوسط', low: 'منخفض' };
  const priorityClass = { high: 'prio-high', medium: 'prio-medium', low: 'prio-low' };

  // ── Focus Strip ──
  const focusEl = document.getElementById('daily-focus-card');
  if (focusEl) {
    const doingTask  = todayTasks.find(t => t.status === 'doing');
    const todoTasks  = todayTasks
      .filter(t => t.status === 'todo')
      .sort((a, b) => {
        const aOver = isOverdue(a) ? 0 : 1;
        const bOver = isOverdue(b) ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        const pRank  = { high: 0, medium: 1, low: 2 };
        const ap = pRank[a.priority] ?? 3;
        const bp = pRank[b.priority] ?? 3;
        if (ap !== bp) return ap - bp;
        const ad = parseDateField(a.endDate);
        const bd = parseDateField(b.endDate);
        if (ad && bd) return ad - bd;
        return ad ? -1 : bd ? 1 : 0;
      });

    const focusTask = doingTask || todoTasks[0] || null;

    if (!focusTask) {
      focusEl.innerHTML = `<span class="focus-strip-label">🎯</span><span class="focus-strip-empty">يوم منجز ✅</span>`;
    } else {
      const proj   = getProject(focusTask);
      const client = getClient(focusTask);
      const days   = daysUntilDeadline(focusTask);
      const deadlineHtml = days !== null && days <= 3
        ? `<span class="focus-deadline ${days < 0 ? 'overdue' : days === 0 ? 'due-today' : 'due-soon'}">${days < 0 ? `${Math.abs(days)}ي متأخر` : days === 0 ? 'اليوم' : `${days}ي`}</span>`
        : '';

      focusEl.innerHTML = `
        <span class="focus-strip-label">🎯 ركز على</span>
        <span class="focus-status-dot status-${focusTask.status}"></span>
        <span class="focus-strip-title">${escapeHtml(focusTask.title)}</span>
        ${focusTask.priority ? `<span class="focus-prio ${priorityClass[focusTask.priority]}">${priorityLabel[focusTask.priority]}</span>` : ''}
        ${proj   ? `<span class="focus-strip-meta">📁 ${escapeHtml(proj.name)}</span>`   : ''}
        ${client ? `<span class="focus-strip-meta">👤 ${escapeHtml(client.name)}</span>` : ''}
        ${deadlineHtml}
        <button class="focus-done-btn"
          data-client="${focusTask._clientId}"
          data-project="${focusTask._projectId}"
          data-id="${focusTask.id}">✅ خلّصت</button>
      `;

      focusEl.querySelector('.focus-done-btn')?.addEventListener('click', async function () {
        const btn = this;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          await updateDoc(taskDoc(btn.dataset.client, btn.dataset.project, btn.dataset.id), {
            status: 'done', completedAt: serverTimestamp(),
          });
          toast('تاسك اتخلصت ✅', 'success');
        } catch (err) {
          toast('فشل التحديث', 'error');
          btn.disabled = false;
          btn.textContent = '✅ خلّصت';
        }
      });
    }
  }

  // ── Section 2: Today's Tasks — grouped by project ──
  const listEl = document.getElementById('daily-today-list');
  if (listEl) {
    if (todayTasks.length === 0) {
      listEl.innerHTML = `<div class="daily-empty">لا توجد مهام مجدولة النهارده</div>`;
    } else {
      // Build project groups map
      const groupMap = new Map();
      todayTasks.forEach(t => {
        const pid = t._projectId || '__none__';
        if (!groupMap.has(pid)) groupMap.set(pid, []);
        groupMap.get(pid).push(t);
      });

      // Sort tasks within each group: overdue → doing → todo → done
      const statusRank = { doing: 0, todo: 1, done: 2 };
      groupMap.forEach(tasks => {
        tasks.sort((a, b) => {
          const aOver = isOverdue(a) ? -1 : statusRank[a.status] ?? 2;
          const bOver = isOverdue(b) ? -1 : statusRank[b.status] ?? 2;
          return aOver - bOver;
        });
      });

      // Sort groups: respect manual project.order first, then fallback to urgency
      const sortedGroups = [...groupMap.entries()].sort(([aPid, aTasks], [bPid, bTasks]) => {
        const aProj = state.allProjects.find(p => p.id === aPid);
        const bProj = state.allProjects.find(p => p.id === bPid);
        const aOrder = aProj?.order ?? 9999;
        const bOrder = bProj?.order ?? 9999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aUrgent = aTasks.filter(t => isOverdue(t) || t.status === 'doing').length;
        const bUrgent = bTasks.filter(t => isOverdue(t) || t.status === 'doing').length;
        if (aUrgent !== bUrgent) return bUrgent - aUrgent;
        const aPending = aTasks.filter(t => t.status !== 'done').length;
        const bPending = bTasks.filter(t => t.status !== 'done').length;
        return bPending - aPending;
      });

      listEl.innerHTML = sortedGroups.map(([pid, tasks]) => {
        const proj   = state.allProjects.find(p => p.id === pid);
        const client = proj ? state.clients.find(c => c.id === proj._clientId) : null;
        const pending = tasks.filter(t => t.status !== 'done').length;
        const hasOverdue = tasks.some(t => isOverdue(t));

        const projLabel = proj
          ? `<span class="proj-grp-name">${escapeHtml(proj.name)}</span>${client ? `<span class="proj-grp-client">· ${escapeHtml(client.name)}</span>` : ''}`
          : `<span class="proj-grp-name">بدون مشروع</span>`;

        const countTag = `<span class="proj-grp-count ${hasOverdue ? 'has-overdue' : ''}">${pending} متبقي</span>`;

        const taskRows = tasks.map(t => {
          const days = daysUntilDeadline(t);
          const dotCls = isOverdue(t) ? 'overdue' : t.status;
          const deadlineTag = (days !== null && days <= 3 && t.status !== 'done')
            ? `<span class="task-row-deadline ${days < 0 ? 'overdue' : days === 0 ? 'due-today' : 'due-soon'}">${days < 0 ? `${Math.abs(days)}ي متأخر` : days === 0 ? 'اليوم' : `${days}ي`}</span>`
            : '';
          return `
            <div class="today-task-row ${t.status === 'done' ? 'is-done' : ''}"
                 data-task-id="${t.id}"
                 data-client-id="${t._clientId || ''}"
                 data-project-id="${t._projectId || ''}">
              <span class="row-status-dot status-${dotCls}"></span>
              <span class="row-title">${escapeHtml(t.title)}</span>
              ${t.priority ? `<span class="row-prio ${priorityClass[t.priority]}">${priorityLabel[t.priority]}</span>` : ''}
              ${deadlineTag}
              ${t.status !== 'done' ? `<button class="row-done-btn"
                data-client="${t._clientId || ''}"
                data-project="${t._projectId || ''}"
                data-id="${t.id}"
                title="خلّص التاسك">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
              </button>` : ''}
            </div>`;
        }).join('');

        const clientId = proj ? (proj._clientId || '') : '';
        return `
          <div class="day-block" draggable="true"
               data-client="${clientId}" data-project="${pid}">
            <div class="proj-grp-header day-block-header" title="اسحب لإعادة الترتيب">
              <div class="proj-grp-info">${projLabel}</div>
              ${countTag}
            </div>
            <div class="proj-grp-tasks">${taskRows}</div>
          </div>`;
      }).join('');
    }
  }

  // ── Section 3: Today's Win ──
  const winEl = document.getElementById('daily-win-bar');
  if (winEl) {
    const doneCount = todayTasks.filter(t => t.status === 'done').length;

    winEl.innerHTML = `
      <div class="win-stat">
        <span class="win-num">${doneCount}</span>
        <span class="win-label">تاسك خلصت</span>
      </div>
    `;
  }

  // ── Wire row done buttons (✓) — mark task done without leaving the page ──
  listEl?.querySelectorAll('.row-done-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // prevent row click → navigate
      if (btn.disabled) return;
      btn.disabled = true;
      // Optimistic UI: mark row visually done immediately
      const row = btn.closest('.today-task-row');
      if (row) {
        row.classList.add('is-done');
        const dot = row.querySelector('.row-status-dot');
        if (dot) dot.className = 'row-status-dot status-done';
        btn.style.opacity = '0';
        setTimeout(() => btn.remove(), 200);
      }
      try {
        await updateDoc(
          taskDoc(btn.dataset.client, btn.dataset.project, btn.dataset.id),
          { status: 'done', completedAt: serverTimestamp() }
        );
        toast('تاسك اتخلصت ✅', 'success');
      } catch (err) {
        toast('فشل التحديث', 'error');
        renderDailySummary(); // revert optimistic on error
      }
    });
  });

  // ── Wire task row clicks → navigate to kanban & highlight ──
  listEl?.querySelectorAll('.today-task-row').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const tid = row.dataset.taskId;
      const cid = row.dataset.clientId;
      const pid = row.dataset.projectId;
      if (!tid || !cid || !pid) return;
      const client  = state.clients.find(c => c.id === cid);
      const project = state.allProjects.find(p => p.id === pid);
      if (!client || !project) return;
      state.pendingHighlightTaskId = tid;
      navigateTo('tasks', { client, project, fromDaily: true });
    });
  });

  // ── Wire block drag & drop ──
  wireDayBlocksDnD('daily-today-list', () => renderDailySummary());
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
//  CALENDAR + DAY VIEW (v9.2)
// ════════════════════════════════════════════════════════════════

function subscribeCalendar() {
  // Reuse same listeners as the dashboard — we need clients, projects, tasks
  if (state.dashUnsubProjects || state.dashUnsubTasks || state.unsubscribe) {
    // Already loaded by dashboard subscriptions — just render
    renderCalendar();
    if (state.view === 'day')   renderDayView();
    if (state.view === 'daily') renderDailySummary();
    return;
  }

  const renderCalAndDay = () => {
    renderCalendar();
    if (state.view === 'day')   renderDayView();
    if (state.view === 'daily') renderDailySummary();
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
    if (t.status === 'backlog') return false;
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
      if (client && project) navigateTo('tasks', { client, project, fromDay: true });
    });
  });

  // ── Block-level DnD (v23.0 — shared via wireDayBlocksDnD) ──
  wireDayBlocksDnD('day-blocks', renderDayView);
}

async function reorderDayProjectBlocks(fromProjectId, toProjectId) {
  await reorderProjectBlocksInContainer('day-blocks', fromProjectId, toProjectId, renderDayView);
}

async function reorderProjectBlocksInContainer(containerId, fromProjectId, toProjectId, rerenderFn) {
  const blockEls = [...document.querySelectorAll(`#${containerId} .day-block`)];
  const orderIds = blockEls.map(b => b.dataset.project);

  const fromIdx = orderIds.indexOf(fromProjectId);
  const toIdx   = orderIds.indexOf(toProjectId);
  if (fromIdx === -1 || toIdx === -1) return;

  orderIds.splice(fromIdx, 1);
  orderIds.splice(toIdx, 0, fromProjectId);

  const batch = writeBatch(db);
  orderIds.forEach((pid, idx) => {
    const proj = state.allProjects.find(p => p.id === pid);
    if (!proj) return;
    const cid = proj._clientId || proj._ref?.parent?.parent?.id;
    if (!cid) return;
    proj.order = idx;
    batch.update(projectDoc(cid, pid), { order: idx });
  });

  rerenderFn();

  try {
    await batch.commit();
  } catch (err) {
    console.error('Failed to save project block order:', err);
    toast('فشل حفظ الترتيب الجديد', 'error');
  }
}

// ── Shared block DnD wiring — works for any day-blocks container ──
function wireDayBlocksDnD(containerId, rerenderFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const clearState = () => {
    state.dayDraggedBlockClient  = null;
    state.dayDraggedBlockProject = null;
    state.dayDragKind            = null;
    container.classList.remove('is-dragging');
    container.querySelectorAll('.day-block').forEach(b =>
      b.classList.remove('drag-over', 'drop-forbidden', 'block-drag-target', 'dragging'));
  };

  if (!container._dndWired) {
    container._dndWired = true;
    container.addEventListener('dragover', e => {
      if (state.dayDragKind === 'block') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    container.addEventListener('drop', e => {
      if (state.dayDragKind === 'block') { e.preventDefault(); clearState(); }
    });
  }

  container.querySelectorAll('.day-block').forEach(block => {
    if (block._blockDndWired) return;
    block._blockDndWired = true;

    const targetProject = block.dataset.project;
    const targetClient  = block.dataset.client;

    block.addEventListener('dragstart', e => {
      if (state.dayDragKind === 'task') return;
      state.dayDragKind            = 'block';
      state.dayDraggedBlockClient  = targetClient;
      state.dayDraggedBlockProject = targetProject;
      block.classList.add('dragging');
      container.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', `block:${targetProject}`); } catch (_) {}
    });

    block.addEventListener('dragend', () => clearState());

    block.addEventListener('dragover', e => {
      if (state.dayDragKind === 'block') {
        if (state.dayDraggedBlockProject === targetProject) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        block.classList.add('block-drag-target');
      }
    });

    block.addEventListener('dragleave', e => {
      if (!block.contains(e.relatedTarget))
        block.classList.remove('drag-over', 'drop-forbidden', 'block-drag-target');
    });

    block.addEventListener('drop', async e => {
      block.classList.remove('drag-over', 'drop-forbidden', 'block-drag-target');
      if (state.dayDragKind !== 'block') return;
      const fromProject = state.dayDraggedBlockProject;
      e.preventDefault();
      clearState();
      if (!fromProject || fromProject === targetProject) return;
      await reorderProjectBlocksInContainer(containerId, fromProject, targetProject, rerenderFn);
    });
  });
}

// ── Wire calendar controls (idempotent) ──
(function setupCalendarControls() {
  const portal = document.getElementById('dash-portal-calendar');
  if (portal) {
    const go = () => navigateTo('calendar');
    portal.addEventListener('click', go);
    portal.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }

  const portalDaily = document.getElementById('dash-portal-daily');
  if (portalDaily) {
    const go = () => navigateTo('daily');
    portalDaily.addEventListener('click', go);
    portalDaily.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }

  const backDaily = document.getElementById('btn-back-daily');
  if (backDaily) backDaily.addEventListener('click', () => navigateTo('dashboard'));

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
  if (backCal) backCal.addEventListener('click', () => navigateTo('clients'));
  if (backDay) backDay.addEventListener('click', () => navigateTo('calendar'));
})();

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

  const groups = { backlog: [], todo: [], doing: [], done: [] };
  filtered.forEach(t => { if (groups[t.status]) groups[t.status].push(t); });

  // Order tasks: unordered (new) tasks appear first (newest at top),
  // then drag-ordered tasks in their saved order.
  const sortInColumn = (a, b) => {
    const aHasOrder = typeof a.orderIndex === 'number';
    const bHasOrder = typeof b.orderIndex === 'number';
    if (aHasOrder !== bHasOrder) return aHasOrder ? 1 : -1;
    if (aHasOrder && bHasOrder) return a.orderIndex - b.orderIndex;
    const at = a.createdAt?.seconds || 0;
    const bt = b.createdAt?.seconds || 0;
    return bt - at;
  };
  groups.backlog.sort(sortInColumn);
  groups.todo.sort(sortInColumn);
  groups.doing.sort(sortInColumn);
  groups.done.sort(sortInColumn);

  // Counters
  const cb = document.getElementById('count-backlog');
  const ct = document.getElementById('count-todo');
  const cd = document.getElementById('count-doing');
  const cn = document.getElementById('count-done');
  if (cb) cb.textContent = groups.backlog.length;
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
    { el: document.getElementById('col-backlog'), tasks: groups.backlog, emptyIcon: '🗂️', emptyText: 'حط هنا المهام\nاللي مش عاوز تشوفها دلوقتي', isTodo: false },
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

  // v23.0 — Scroll to and highlight a task coming from the daily summary
  if (state.pendingHighlightTaskId) {
    const tid = state.pendingHighlightTaskId;
    state.pendingHighlightTaskId = null;
    requestAnimationFrame(() => {
      const card = document.getElementById(`tc-${tid}`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('task-highlight');
      setTimeout(() => card.classList.remove('task-highlight'), 2200);
    });
  }
}

function taskCardHTML(task) {
  // v19.0 — Per-task hours dropped; tracking lives on the project doc now.

  // Inline thumbnail with hard corners — clicking opens a full-size lightbox.
  const imgBlock = task.imageUrl
    ? `<img class="task-card-thumb" src="${task.imageUrl}" alt="" data-img="${task.imageUrl}" title="عرض الصورة" />`
    : '';

  const planBadge = task.inPlan
    ? `<span class="card-plan-badge in-plan" title="ضمن الخطة">🎯 في الخطة</span>`
    : '';
  const planToggleBtn = `<button class="card-plan-btn" data-id="${task.id}" title="${task.inPlan ? 'إزالة من الخطة' : 'إضافة للخطة'}">${task.inPlan ? '★' : '☆'}</button>`;

  return `
    <div class="task-card${task.inPlan ? ' in-plan' : ''}" id="tc-${task.id}" draggable="true" data-id="${task.id}">
      <div class="card-top" style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div class="card-title">${escapeHtml(task.title)}</div>
        <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
          ${planToggleBtn}
          <button class="card-edit-btn" data-id="${task.id}" title="تعديل المهمة">✏️</button>
          <button class="card-menu-btn" data-id="${task.id}" title="حذف المهمة">✕</button>
        </div>
      </div>
      ${planBadge}
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

let _columnDnDWired = false;
function setupColumnDnD() {
  // Columns are static in index.html (only .col-body is re-rendered), so we
  // bind once. Guard against accidental re-binding to avoid duplicate handlers.
  if (_columnDnDWired) return;
  _columnDnDWired = true;
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

      const labels = { backlog: 'Backlog', todo: 'المطلوب', doing: 'جاري التنفيذ', done: 'تم الإنتهاء' };
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

  // Centered header greeting: only on the hub, cleared elsewhere.
  const greetEl = document.getElementById('dash-greeting');
  if (greetEl) greetEl.textContent = state.view === 'dashboard' ? greetingText() : '';

  if (state.view === 'dashboard') {
    titleEl.textContent  = '📊 الرئيسية';
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

  } else if (['finance','finance-summary','finance-banks','finance-bank','finance-envelopes','finance-envelope','finance-gold','finance-liabilities'].includes(state.view)) {
    titleEl.textContent = '💰 المركز المالي';
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';
  }
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  if (state.view === 'dashboard' || state.view === 'clients' || state.view === 'finance' || (state.view === 'projects' && !state.client)) {
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

  // ── Finance breadcrumbs ──
  if (state.view === 'finance-summary') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">ملخص المصروفات</span>`;
  } else if (state.view === 'finance-banks') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">🏦 البنوك</span>`;
  } else if (state.view === 'finance-bank') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance-banks">🏦 البنوك</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">${escapeHtml(state.bank?.name || '')}</span>`;
  } else if (state.view === 'finance-envelopes') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">✉️ الأظرف</span>`;
  } else if (state.view === 'finance-envelope') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance-envelopes">✉️ الأظرف</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">${escapeHtml(state.envelope?.name || '')}</span>`;
  } else if (state.view === 'finance-gold') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">🥇 الذهب</span>`;
  } else if (state.view === 'finance-liabilities') {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">💳 الالتزامات</span>`;
  }

  if (state.view === 'tasks') {
    html += `<span class="breadcrumb-sep">›</span>`;
    if (state.navigationSource === 'day') {
      html += `<span class="breadcrumb-link" data-to="day">التقويم اليومي</span>
               <span class="breadcrumb-sep">›</span>
               <span class="breadcrumb-current">${escapeHtml(state.project?.name)}</span>`;
    } else if (state.navigationSource === 'daily') {
      html += `<span class="breadcrumb-link" data-to="daily">ملخص النهارده</span>
               <span class="breadcrumb-sep">›</span>
               <span class="breadcrumb-current">${escapeHtml(state.project?.name)}</span>`;
    } else if (state.navigationSource === 'dashboard') {
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
      } else if (to === 'daily') {
        navigateTo('daily');
      } else if (to === 'day') {
        navigateTo('day', { date: state.dayDate || new Date() });
      } else if (to === 'clients') {
        navigateTo('clients');
      } else if (to && to.startsWith('finance')) {
        navigateTo(to);
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

// Promise-based custom confirm modal so we never fall back to the browser's
// native window.confirm.
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
// Firestore caps a single writeBatch at 500 operations. A client with many
// projects/tasks can exceed that, so we collect every ref first and flush in
// chunks. Chunks aren't atomic across each other, but for deletion that's
// safe — a failed run just leaves leftovers that a re-run cleans up.
async function commitDeletesInChunks(refs, chunkSize = 450) {
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(db);
    refs.slice(i, i + chunkSize).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

async function deleteClientCascade(clientId) {
  const refs = [];
  const projectsSnap = await getDocs(projectsRef(clientId));

  for (const pDoc of projectsSnap.docs) {
    const tasksSnap = await getDocs(tasksRef(clientId, pDoc.id));
    tasksSnap.docs.forEach(tDoc => refs.push(tDoc.ref));
    refs.push(pDoc.ref);
  }
  refs.push(clientDoc(clientId));
  await commitDeletesInChunks(refs);
}

async function deleteProjectCascade(clientId, projectId) {
  const refs = [];
  const tasksSnap = await getDocs(tasksRef(clientId, projectId));
  tasksSnap.docs.forEach(tDoc => refs.push(tDoc.ref));
  refs.push(projectDoc(clientId, projectId));
  await commitDeletesInChunks(refs);
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
//  FEATURE: MOVE ALL TASKS TO NEXT STAGE
// ════════════════════════════════════════════════════════════════

async function moveAllTasksToNext(fromStatus, toStatus) {
  if (!state.client || !state.project) return;
  const tasks = state.tasks.filter(t => t.status === fromStatus);
  if (tasks.length === 0) {
    toast('مفيش تاسكات هنا', 'info');
    return;
  }
  const labels = { todo: 'المطلوب', doing: 'جاري التنفيذ', done: 'تم الإنتهاء' };
  try {
    const batch = writeBatch(db);
    tasks.forEach(t => {
      const update = { status: toStatus };
      if (toStatus === 'done') update.completedAt = serverTimestamp();
      batch.update(taskDoc(state.client.id, state.project.id, t.id), update);
    });
    await batch.commit();
    toast(`تم نقل ${tasks.length} تاسك إلى "${labels[toStatus]}" ✅`, 'success');
  } catch (err) {
    toast('فشل نقل التاسكات', 'error');
    console.error(err);
  }
}

document.getElementById('col-move-todo-btn')?.addEventListener('click', () => {
  moveAllTasksToNext('todo', 'doing');
});
document.getElementById('col-move-doing-btn')?.addEventListener('click', () => {
  moveAllTasksToNext('doing', 'done');
});


// ════════════════════════════════════════════════════════════════
//  FEATURE: SETTINGS MODAL
// ════════════════════════════════════════════════════════════════

function getGeminiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

function openSettingsModal() {
  const overlay   = document.getElementById('settings-modal-overlay');
  const keyInput  = document.getElementById('settings-gemini-key');
  const statusEl  = document.getElementById('settings-gemini-status');
  if (!overlay) return;

  const existing = getGeminiKey();
  if (keyInput) {
    keyInput.value = existing ? '••••••••••••••••' : '';
    keyInput.dataset.unchanged = existing ? 'true' : 'false';
    keyInput.type = 'password';
  }
  if (statusEl) {
    statusEl.textContent = existing ? '✅ Key محفوظ' : '❌ لا يوجد Key';
    statusEl.className   = 'settings-key-status ' + (existing ? 'has-key' : 'no-key');
  }
  overlay.classList.remove('hidden');
}

function saveSettings() {
  const keyInput = document.getElementById('settings-gemini-key');
  const statusEl = document.getElementById('settings-gemini-status');
  const val      = keyInput?.value.trim();

  if (keyInput?.dataset.unchanged === 'true' && val === '••••••••••••••••') {
    // unchanged — just close
    document.getElementById('settings-modal-overlay')?.classList.add('hidden');
    return;
  }

  if (val && val !== '••••••••••••••••') {
    localStorage.setItem('gemini_api_key', val);
    if (statusEl) { statusEl.textContent = '✅ Key محفوظ'; statusEl.className = 'settings-key-status has-key'; }
    toast('تم حفظ Gemini API Key ✅', 'success');
  } else if (!val) {
    localStorage.removeItem('gemini_api_key');
    if (statusEl) { statusEl.textContent = '❌ تم مسح الـ Key'; statusEl.className = 'settings-key-status no-key'; }
    toast('تم مسح الـ Key', 'info');
  }
  document.getElementById('settings-modal-overlay')?.classList.add('hidden');
}

document.getElementById('btn-open-settings')?.addEventListener('click', openSettingsModal);
document.getElementById('close-settings-modal-btn')?.addEventListener('click', () => {
  document.getElementById('settings-modal-overlay')?.classList.add('hidden');
});
document.getElementById('cancel-settings-modal-btn')?.addEventListener('click', () => {
  document.getElementById('settings-modal-overlay')?.classList.add('hidden');
});
document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);

// Toggle key visibility
document.getElementById('settings-toggle-key-vis')?.addEventListener('click', () => {
  const inp = document.getElementById('settings-gemini-key');
  if (!inp) return;
  // If still showing bullets placeholder, clear it so user can type
  if (inp.dataset.unchanged === 'true') {
    inp.value = '';
    inp.dataset.unchanged = 'false';
  }
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// ════════════════════════════════════════════════════════════════
//  FEATURE: GEMINI AI PLAN
// ════════════════════════════════════════════════════════════════

function openAiPlanModal() {
  if (!state.client || !state.project) {
    toast('افتح مشروع الأول', 'error');
    return;
  }
  const overlay       = document.getElementById('ai-modal-overlay');
  const noKeySection  = document.getElementById('ai-api-key-section');
  const planSection   = document.getElementById('ai-plan-section');
  const tasksSummary  = document.getElementById('ai-plan-tasks-summary');
  const tasksList     = document.getElementById('ai-plan-tasks-list');
  const planContent   = document.getElementById('ai-plan-content');
  const planStatus    = document.getElementById('ai-plan-status');
  const submitBtn     = document.getElementById('submit-ai-modal-btn');
  if (!overlay) return;

  const hasKey = !!getGeminiKey();

  // Show/hide no-key notice
  noKeySection.classList.toggle('hidden', hasKey);
  submitBtn.disabled = !hasKey;

  // Show tasks marked inPlan
  const inPlanTasks = state.tasks.filter(t => t.inPlan);
  if (tasksList) {
    if (inPlanTasks.length === 0) {
      tasksList.innerHTML = '<span class="ai-no-tasks">لا توجد تاسكات محددة — اضغط ☆ على أي تاسك لإضافته</span>';
    } else {
      const statusIcon = { todo: '⬜', doing: '🟡', done: '✅' };
      tasksList.innerHTML = inPlanTasks.map(t =>
        `<div class="ai-task-chip">${statusIcon[t.status] || '⬜'} ${escapeHtml(t.title)}</div>`
      ).join('');
    }
    tasksSummary.classList.remove('hidden');
  }

  // Show previously saved brief if exists
  const savedBrief = state.project.aiBrief;
  if (savedBrief) {
    planSection.classList.remove('hidden');
    planContent.value = savedBrief.content || '';
    planStatus.textContent = `آخر brief: ${new Date((savedBrief.generatedAt?.seconds || 0) * 1000).toLocaleDateString('ar-EG')} · ${savedBrief.taskCount || 0} تاسك`;
  } else {
    planSection.classList.add('hidden');
    planContent.value = '';
    planStatus.textContent = '';
  }

  submitBtn.textContent = inPlanTasks.length > 0 ? `✨ توليد Brief (${inPlanTasks.length} تاسك)` : '✨ توليد البريف';
  overlay.classList.remove('hidden');
}

async function submitAiPlanModal() {
  const planSection = document.getElementById('ai-plan-section');
  const planContent = document.getElementById('ai-plan-content');
  const planStatus  = document.getElementById('ai-plan-status');
  const submitBtn   = document.getElementById('submit-ai-modal-btn');

  const apiKey = getGeminiKey();
  if (!apiKey) {
    toast('حط Gemini API Key في الإعدادات ⚙️ الأول', 'error');
    return;
  }

  if (!state.client || !state.project) return;

  const inPlanTasks = state.tasks.filter(t => t.inPlan);
  const allTasks    = state.tasks;

  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Gemini شغّال...';
  planSection.classList.remove('hidden');
  planStatus.textContent = 'جاري التوليد...';
  planContent.value = '';

  // Build detailed task description for Gemini
  const priorityAr = { high: 'عالية 🔴', medium: 'متوسطة 🟡', low: 'منخفضة 🟢' };
  const statusAr   = { todo: 'لم تبدأ', doing: 'جاري التنفيذ', done: 'منتهية' };

  const targetTasks = inPlanTasks.length > 0 ? inPlanTasks : allTasks.filter(t => t.status !== 'done');

  const taskDetails = targetTasks.map((t, i) => {
    const lines = [`${i + 1}. ${t.title}`];
    if (t.status) lines.push(`   - الحالة: ${statusAr[t.status] || t.status}`);
    if (t.priority) lines.push(`   - الأولوية: ${priorityAr[t.priority] || t.priority}`);
    if (t.notes) lines.push(`   - تفاصيل: ${t.notes}`);
    return lines.join('\n');
  }).join('\n\n');

  const otherDone = allTasks.filter(t => t.status === 'done' && !t.inPlan);

  const prompt = `أنت خبير تقني متخصص في كتابة Task Briefs جاهزة للإرسال لـ AI assistant (Claude) لتنفيذها مباشرةً في الكود.

المعلومات:
- المشروع: "${state.project.name || 'مشروع'}"
- العميل: "${state.client.name || 'عميل'}"
- المهام المنجزة مسبقاً: ${otherDone.length} مهمة

المهام المطلوب عمل Brief لها (${targetTasks.length} مهمة):
${taskDetails || 'لا توجد مهام محددة'}

اكتب Brief واضح ومفصّل جاهز للإرسال لـ Claude مباشرة بدون أي تعديل.

البريف يجب أن:
1. يبدأ بجملة سياق قصيرة عن المشروع والعميل
2. يشرح كل مهمة بوضوح كامل — ما المطلوب بالضبط
3. يحدد ترتيب التنفيذ المنطقي
4. يذكر أي قيود أو اعتبارات تقنية مذكورة في التفاصيل
5. يكون مباشراً وتنفيذياً — Claude يقدر يشتغل عليه فوراً

اكتب البريف بالعربي. لا تضيف مقدمات أو شرح — ابدأ مباشرة بالبريف.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg  = errBody?.error?.message || '';
      console.error('Gemini full error:', JSON.stringify(errBody, null, 2));
      if (res.status === 400 && errMsg.includes('API_KEY')) {
        localStorage.removeItem('gemini_api_key');
        throw new Error('API Key غلط — تم مسحه، حاول تاني');
      }
      if (res.status === 429) throw new Error(`429: ${errMsg || 'Too Many Requests'}`);
      throw new Error(`Gemini error ${res.status}: ${errMsg}`);
    }

    const data    = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '—';

    // Save brief to project doc
    await updateDoc(projectDoc(state.client.id, state.project.id), {
      aiBrief: { content, generatedAt: serverTimestamp(), taskCount: targetTasks.length },
    });

    planContent.value = content;
    planStatus.textContent = `✅ جاهز — ${targetTasks.length} تاسك · الآن`;
    toast('البريف جاهز — انسخه وابعته! 🚀', 'success');
  } catch (err) {
    planStatus.textContent = `خطأ: ${err.message}`;
    toast(err.message, 'error');
    console.error(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '✨ توليد Brief جديد';
  }
}

document.getElementById('btn-ai-plan')?.addEventListener('click', openAiPlanModal);
document.getElementById('close-ai-modal-btn')?.addEventListener('click', () => {
  document.getElementById('ai-modal-overlay')?.classList.add('hidden');
});
document.getElementById('cancel-ai-modal-btn')?.addEventListener('click', () => {
  document.getElementById('ai-modal-overlay')?.classList.add('hidden');
});
document.getElementById('submit-ai-modal-btn')?.addEventListener('click', submitAiPlanModal);
document.getElementById('btn-copy-brief')?.addEventListener('click', () => {
  const ta = document.getElementById('ai-plan-content');
  if (!ta?.value) return;
  navigator.clipboard.writeText(ta.value).then(() => {
    const btn = document.getElementById('btn-copy-brief');
    const orig = btn.textContent;
    btn.textContent = '✅ تم النسخ!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
});

// ── Toggle inPlan on task card ──────────────────────────────────
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.card-plan-btn');
  if (!btn || !state.client || !state.project) return;
  e.stopPropagation();
  const taskId = btn.dataset.id;
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  btn.disabled = true;
  try {
    await updateDoc(taskDoc(state.client.id, state.project.id, taskId), {
      inPlan: !task.inPlan,
    });
  } catch (err) {
    toast('فشل التحديث', 'error');
    btn.disabled = false;
  }
});


// ════════════════════════════════════════════════════════════════
//  FINANCE HUB (المركز المالي) — Envelopes · Banks · Gold · Rules
// ════════════════════════════════════════════════════════════════
//  FINANCE HUB (المصروفات) — Envelopes · Banks · Gold · Rules
// ════════════════════════════════════════════════════════════════

const FIN_CUR = 'ج.م';

// ── Small helpers ──────────────────────────────────────────────
function finFmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function finPriv(inner) { return `<span class="privacy-sensitive">${inner}</span>`; }
// Category color for an envelope/bank — stored color, else deterministic from the name
function finColorFor(item) {
  if (item && item.color) return item.color;
  const s = (item && item.name) || '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
function finHexA(hex, a) {
  const m = String(hex || '#3574F0').replace('#', '');
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function finBadge(icon, color) {
  return `<span class="fin-card-icon" style="background:${finHexA(color, .16)};border-color:${finHexA(color, .42)}">${escapeHtml(icon)}</span>`;
}
function finTsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  const t = new Date(ts).getTime();
  return isNaN(t) ? 0 : t;
}
const finShow = (id) => document.getElementById(id)?.classList.remove('hidden');
const finHide = (id) => document.getElementById(id)?.classList.add('hidden');

// ── Monthly segregation helpers (الفصل الشهري MM-YYYY) ──────────
// Period key is 'YYYY-MM'. Derived from a JS Date or a Firestore ts.
function finThisPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function finPeriodOf(ts) {
  const ms = finTsMillis(ts);
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// A tx belongs to a period via its stored `period` (new txs) or its createdAt (legacy).
function finTxPeriod(t) {
  return t.period || finPeriodOf(t.createdAt);
}
// Human label for a 'YYYY-MM' key, e.g. 'يوليو 2026'.
function finPeriodLabel(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return '—';
  return new Date(y, m - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
}
// Shift a 'YYYY-MM' key by n months.
function finShiftPeriod(key, n) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(y, (m - 1) + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── renderFinHub — router that picks the right render fn ───────
function renderFinHub() {
  updateDashFinancePortal();
  const v = state.view;
  if      (v === 'finance')           renderFinanceHome();
  else if (v === 'finance-banks')     renderBanksList();
  else if (v === 'finance-bank')      renderBankDetail();
  else if (v === 'finance-envelopes') renderEnvelopesBox();
  else if (v === 'finance-envelope')  renderEnvelopeDetail();
  else if (v === 'finance-gold')      renderGoldBox();
  else if (v === 'finance-liabilities') renderLiabilities();
  else if (v === 'finance-summary')   renderFinanceSummary();
}

// ── Subscriptions ──────────────────────────────────────────────
function subscribeFinance() {
  const push = (u) => state.finUnsub.push(u);
  const onErr = (label) => (e) => console.error('finance snapshot:', label, e);

  push(onSnapshot(banksRef(), snap => {
    state.banks = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    setOnline();
    debounceRender(renderFinHub);
  }, onErr('banks')));

  push(onSnapshot(envelopesRef(), snap => {
    state.envelopes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    debounceRender(renderFinHub);
  }, onErr('envelopes')));

  push(onSnapshot(transactionsRef(), snap => {
    state.transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    debounceRender(renderFinHub);
  }, onErr('transactions')));

  push(onSnapshot(goldAssetsRef(), snap => {
    state.goldAssets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    debounceRender(renderFinHub);
  }, onErr('gold')));

  push(onSnapshot(allocRuleDoc('salary'), d => {
    state.allocRules.salary = d.exists() ? (d.data().allocations || []) : [];
    debounceRender(renderFinHub);
  }, onErr('rule.salary')));

  push(onSnapshot(allocRuleDoc('freelance'), d => {
    state.allocRules.freelance = d.exists() ? (d.data().allocations || []) : [];
    debounceRender(renderFinHub);
  }, onErr('rule.freelance')));

  push(onSnapshot(goldPricesDoc(), d => {
    state.goldPrices = d.exists() ? d.data() : null;
    debounceRender(renderFinHub);
  }, onErr('goldPrices')));

  push(onSnapshot(liabilitiesRef(), snap => {
    state.liabilities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    debounceRender(renderFinHub);
  }, onErr('liabilities')));

  push(onSnapshot(finSettingsDoc(), d => {
    state.finSettings = d.exists() ? { unallocatedEnvelopeId: null, ...d.data() } : { unallocatedEnvelopeId: null };
    debounceRender(renderFinHub);
  }, onErr('finSettings')));

  // Immediate paint with whatever data is already in state
  renderFinHub();
}

function toggleFinPrivacy() {
  const mainView = document.getElementById('view-finance');
  if (!mainView) return;
  const revealed = mainView.classList.toggle('privacy-revealed');
  ['view-finance-banks','view-finance-bank','view-finance-envelopes','view-finance-envelope','view-finance-gold','view-finance-summary'].forEach(id => {
    document.getElementById(id)?.classList.toggle('privacy-revealed', revealed);
  });
  document.querySelectorAll('.fin-priv-toggle').forEach(btn => btn.setAttribute('aria-pressed', String(revealed)));
  document.getElementById('btn-fin-privacy')?.setAttribute('aria-pressed', String(revealed));
}

// ── Render ─────────────────────────────────────────────────────
function updateDashFinancePortal() {
  const dashFinSub = document.getElementById('dash-finance-subtitle');
  if (!dashFinSub) return;
  const banksTotal  = state.banks.reduce((s, b) => s + (Number(b.current_balance) || 0), 0);
  const byK = { 24: 0, 21: 0, 18: 0 };
  state.goldAssets.forEach(a => { const k = Number(a.karat); if (byK[k] !== undefined) byK[k] += Number(a.grams_owned) || 0; });
  const goldGrams   = byK[24] + byK[21] + byK[18];
  const goldValue   = byK[24] * finPricePerGram(24) + byK[21] * finPricePerGram(21) + byK[18] * finPricePerGram(18);
  const hasPrices   = !!(finPricePerGram(24) || finPricePerGram(21) || finPricePerGram(18));
  const totalAssets = banksTotal + goldValue;
  const parts = [`🏦 ${finFmt(banksTotal)}`];
  if (hasPrices && goldGrams > 0) parts.push(`🥇 ${finFmt(goldValue)}`);
  dashFinSub.innerHTML = `${finFmt(totalAssets)} ${FIN_CUR} &nbsp;·&nbsp; ${parts.join(' · ')}`;
}

// ── Monthly strip (الفصل الشهري) — month nav + income/expense/net ──
function renderFinMonthStrip() {
  const strip = document.getElementById('fin-month-strip');
  if (!strip) return;
  const period = state.finPeriod || finThisPeriod();
  const monthTxs = state.transactions.filter(t => finTxPeriod(t) === period);
  const income  = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const expense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const net     = income - expense;
  const isCurrent = period === finThisPeriod();
  strip.innerHTML = `
    <div class="fin-month-nav">
      <button class="fin-month-btn" id="fin-month-prev" type="button" title="الشهر السابق">‹</button>
      <span class="fin-month-label">📅 ${escapeHtml(finPeriodLabel(period))}</span>
      <button class="fin-month-btn" id="fin-month-next" type="button" title="الشهر التالي" ${isCurrent ? 'disabled' : ''}>›</button>
      ${isCurrent ? '' : '<button class="fin-month-today" id="fin-month-today" type="button">الشهر الحالي</button>'}
    </div>
    <div class="fin-month-figures">
      <div class="fin-month-fig income">
        <span class="fin-month-fig-lbl">دخل الشهر</span>
        <span class="fin-month-fig-val privacy-sensitive">+${finFmt(income)} <span class="fin-cur">${FIN_CUR}</span></span>
      </div>
      <div class="fin-month-fig expense">
        <span class="fin-month-fig-lbl">مصروف الشهر</span>
        <span class="fin-month-fig-val privacy-sensitive">−${finFmt(expense)} <span class="fin-cur">${FIN_CUR}</span></span>
      </div>
      <div class="fin-month-fig net">
        <span class="fin-month-fig-lbl">صافي الشهر</span>
        <span class="fin-month-fig-val privacy-sensitive ${net < 0 ? 'is-neg' : 'is-pos'}">${net < 0 ? '−' : '+'}${finFmt(Math.abs(net))} <span class="fin-cur">${FIN_CUR}</span></span>
      </div>
    </div>`;
  document.getElementById('fin-month-prev')?.addEventListener('click', () => { state.finPeriod = finShiftPeriod(period, -1); renderFinanceHome(); });
  document.getElementById('fin-month-next')?.addEventListener('click', () => { if (!isCurrent) { state.finPeriod = finShiftPeriod(period, 1); renderFinanceHome(); } });
  document.getElementById('fin-month-today')?.addEventListener('click', () => { state.finPeriod = finThisPeriod(); renderFinanceHome(); });
}

function renderFinanceHome() {
  if (state.view !== 'finance') return;

  renderFinMonthStrip();

  // Compute numbers
  const banksTotal = state.banks.reduce((s, b) => s + (Number(b.current_balance) || 0), 0);
  const byK = { 24: 0, 21: 0, 18: 0 };
  state.goldAssets.forEach(a => { const k = Number(a.karat); if (byK[k] !== undefined) byK[k] += Number(a.grams_owned) || 0; });
  const goldGrams  = byK[24] + byK[21] + byK[18];
  const goldValue  = byK[24] * finPricePerGram(24) + byK[21] * finPricePerGram(21) + byK[18] * finPricePerGram(18);
  const hasPrices  = !!(finPricePerGram(24) || finPricePerGram(21) || finPricePerGram(18));

  // ── Hub cards (entity-card style, rendered into #fin-hub-cards) ──
  const grid = document.getElementById('fin-hub-cards');
  if (!grid) return;

  const envTotal = state.envelopes.reduce((s, e) => s + (Number(e.current_balance) || 0), 0);

  const hubCard = ({ id, icon, name, count, val, sub }) => `
    <div class="entity-card fin-hub-card" id="${id}" role="button" tabindex="0">
      <div class="card-header-row">
        <div class="card-avatar fin-hub-icon">${icon}</div>
        <span class="fin-hub-count">${count}</span>
      </div>
      <div class="card-name">${name}</div>
      <div class="fin-hub-card-val privacy-sensitive">${val}</div>
      <div class="card-meta">
        <span class="fin-hub-sub">${sub}</span>
        <span class="card-arrow">←</span>
      </div>
    </div>`;

  grid.innerHTML =
    hubCard({
      id: 'fin-hub-banks', icon: '🏦',
      name: 'البنوك والسيولة', count: `${state.banks.length} بنك`,
      val: `${finFmt(banksTotal)} <span class="fin-cur">${FIN_CUR}</span>`,
      sub: state.banks.length ? state.banks.map(b => escapeHtml(b.name)).join(' · ') : 'أضف بنكك الأول',
    }) +
    hubCard({
      id: 'fin-hub-envelopes', icon: '✉️',
      name: 'الأظرف', count: `${state.envelopes.length} ظرف`,
      val: `${finFmt(envTotal)} <span class="fin-cur">${FIN_CUR}</span>`,
      sub: state.envelopes.length ? state.envelopes.map(e => escapeHtml(e.name)).join(' · ') : 'أضف ظرفك الأول',
    }) +
    hubCard({
      id: 'fin-hub-gold', icon: '🥇',
      name: 'خزنة الذهب', count: `${finFmt(goldGrams)} جم`,
      val: hasPrices ? `${finFmt(goldValue)} <span class="fin-cur">${FIN_CUR}</span>` : `${finFmt(goldGrams)} <span class="fin-cur">جرام</span>`,
      sub: hasPrices ? 'السعر محدّث' : 'حدّد الأسعار لعرض القيمة',
    });

  // Wire clicks
  document.getElementById('fin-hub-banks')?.addEventListener('click', () => navigateTo('finance-banks'));
  document.getElementById('fin-hub-envelopes')?.addEventListener('click', () => navigateTo('finance-envelopes'));
  document.getElementById('fin-hub-gold')?.addEventListener('click', () => navigateTo('finance-gold'));
  document.getElementById('fin-hub-banks')?.addEventListener('keydown', e => { if (e.key === 'Enter') navigateTo('finance-banks'); });
  document.getElementById('fin-hub-envelopes')?.addEventListener('keydown', e => { if (e.key === 'Enter') navigateTo('finance-envelopes'); });
  document.getElementById('fin-hub-gold')?.addEventListener('keydown', e => { if (e.key === 'Enter') navigateTo('finance-gold'); });

  if (!document.getElementById('manage-modal-overlay')?.classList.contains('hidden')) {
    renderManageList();
  }
}

// legacy alias kept for modal re-renders
function renderFinance() { renderFinanceHome(); }

function renderFinanceSummary() {
  if (state.view !== 'finance-summary') return;
  const el = document.getElementById('fin-summary-content');
  if (!el) return;

  const banksTotal  = state.banks.reduce((s, b) => s + (Number(b.current_balance) || 0), 0);
  const byK = { 24: 0, 21: 0, 18: 0 };
  state.goldAssets.forEach(a => { const k = Number(a.karat); if (byK[k] !== undefined) byK[k] += Number(a.grams_owned) || 0; });
  const goldGrams   = byK[24] + byK[21] + byK[18];
  const goldValue   = byK[24] * finPricePerGram(24) + byK[21] * finPricePerGram(21) + byK[18] * finPricePerGram(18);
  const hasPrices   = !!(finPricePerGram(24) || finPricePerGram(21) || finPricePerGram(18));
  const totalAssets = banksTotal + goldValue;

  // Build card definitions using entity-card style
  const mkCard = (id, icon, label, valueHtml, extra = '', envId = '') =>
    `<div class="entity-card fin-sum-card-draggable" data-card-id="${id}" ${envId ? `data-sum-env="${envId}"` : ''} draggable="true" role="button" tabindex="0">
      <div class="card-header-row">
        <div class="fin-sum-entity-icon">${icon}</div>
      </div>
      <div class="card-name">${label}</div>
      <div class="card-meta">
        <span class="fin-sum-entity-val privacy-sensitive">${valueHtml}</span>
        <span class="card-arrow">←</span>
      </div>
      ${extra}
    </div>`;

  const cardDefs = {
    banks: mkCard('banks', '🏦', 'البنوك والسيولة',
      `${finFmt(banksTotal)} <span class="fin-sum-card-cur">${FIN_CUR}</span>`),
    gold: mkCard('gold', '🥇', 'الذهب',
      `<span style="color:#F0A835">${hasPrices ? finFmt(goldValue) + ' ' + FIN_CUR : finFmt(goldGrams) + ' جم'}</span>`),
  };
  state.envelopes.forEach(e => {
    const remaining = Number(e.current_balance) || 0;
    const budget    = Number(e.budget) || 0;
    const pct    = budget > 0 ? Math.min(100, Math.round((remaining / budget) * 100)) : -1;
    const pctCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'ok';
    const prog   = pct >= 0 ? `<div class="fin-card-prog"><div class="fin-card-prog-fill ${pctCls}" style="width:${pct}%"></div></div>` : '';
    cardDefs['env-' + e.id] = mkCard(
      'env-' + e.id,
      escapeHtml(e.icon || '✉️'),
      escapeHtml(e.name || ''),
      `${finFmt(remaining)} <span class="fin-sum-card-cur">${FIN_CUR}</span>`,
      prog,
      e.id
    );
  });

  // Load saved order, filter to only existing cards, then append any new ones
  const allIds = Object.keys(cardDefs);
  let savedOrder = [];
  try { savedOrder = JSON.parse(localStorage.getItem('finSummaryOrder') || '[]'); } catch(e) {}
  const orderedIds = [
    ...savedOrder.filter(id => allIds.includes(id)),
    ...allIds.filter(id => !savedOrder.includes(id))
  ];

  el.innerHTML = `
    <div class="fin-sum-grid" id="fin-sum-grid">
      <div class="fin-sum-card fin-sum-card-hero">
        <div class="fin-sum-card-icon">💰</div>
        <div class="fin-sum-card-body">
          <div class="fin-sum-card-label">صافي الأصول</div>
          <div class="fin-sum-card-value privacy-sensitive">${finFmt(totalAssets)} <span class="fin-sum-card-cur">${FIN_CUR}</span></div>
        </div>
      </div>
      ${orderedIds.map(id => cardDefs[id]).join('')}
    </div>`;

  // Wire click events
  el.querySelector('[data-card-id="banks"]')?.addEventListener('click', () => navigateTo('finance-banks'));
  el.querySelector('[data-card-id="gold"]')?.addEventListener('click', () => navigateTo('finance-gold'));
  el.querySelectorAll('[data-sum-env]').forEach(tag => {
    tag.addEventListener('click', () => {
      const envelope = state.envelopes.find(e => e.id === tag.dataset.sumEnv);
      if (envelope) navigateTo('finance-envelope', { envelope });
    });
  });

  // Wire drag-and-drop (same pattern as clients page)
  const grid = document.getElementById('fin-sum-grid');
  grid.querySelectorAll('.fin-sum-card-draggable').forEach(card => {
    card.addEventListener('dragstart', e => {
      state.draggedEntityId   = card.dataset.cardId;
      state.draggedEntityType = 'fin-summary-card';
      card.classList.add('dragging-card');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging-card');
      state.draggedEntityId   = null;
      state.draggedEntityType = null;
      grid.querySelectorAll('.fin-sum-card-draggable').forEach(c => c.classList.remove('drag-over-card'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (state.draggedEntityType !== 'fin-summary-card' || state.draggedEntityId === card.dataset.cardId) return;
      grid.querySelectorAll('.fin-sum-card-draggable').forEach(c => c.classList.remove('drag-over-card'));
      card.classList.add('drag-over-card');
    });
    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over-card');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over-card');
      const fromId = state.draggedEntityId;
      const toId   = card.dataset.cardId;
      if (!fromId || fromId === toId) return;

      let saved = [];
      try { saved = JSON.parse(localStorage.getItem('finSummaryOrder') || '[]'); } catch(err) {}
      const allIds = Object.keys(cardDefs);
      let order = [
        ...saved.filter(id => allIds.includes(id)),
        ...allIds.filter(id => !saved.includes(id))
      ];
      const fromIdx = order.indexOf(fromId);
      const toIdx   = order.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, fromId);
      localStorage.setItem('finSummaryOrder', JSON.stringify(order));
      renderFinanceSummary();
    });
  });
}

function renderEnvelopesBox() {
  const grid = document.getElementById('fin-envelopes-grid');
  const totalEl = document.getElementById('fin-envelopes-total');
  if (!grid) return;
  const env = state.envelopes;
  const total = env.reduce((s, e) => s + (Number(e.current_balance) || 0), 0);
  if (totalEl) totalEl.innerHTML = env.length ? `الإجمالي: ${finPriv(finFmt(total) + ' ' + FIN_CUR)}` : '';
  if (!env.length) {
    grid.innerHTML = `<div class="fin-empty">مفيش أظرف لسه — <span class="fin-empty-link" data-fin-open="manage-envelopes">أضف ظرف</span></div>`;
    return;
  }
  grid.innerHTML = env.map(e => {
    const bal = Number(e.current_balance) || 0;
    const budget = Number(e.budget) || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((bal / budget) * 100)) : -1;
    const pctCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'ok';
    return `<div class="fin-card fin-card-link" data-env-id="${e.id}" role="button" tabindex="0">
      ${finBadge(e.icon || '✉️', finColorFor(e))}
      <div class="fin-card-info">
        <span class="fin-card-name">${escapeHtml(e.name || '')}</span>
        <span class="fin-card-balance ${bal < 0 ? 'is-neg' : ''}">${finPriv(finFmt(bal))}<span class="fin-cur">${FIN_CUR}</span></span>
        ${pct >= 0 ? `<div class="fin-card-prog"><div class="fin-card-prog-fill ${pctCls}" style="width:${pct}%"></div></div>` : ''}
      </div>
      <span class="fin-card-arrow">←</span>
    </div>`;
  }).join('');

  grid.querySelectorAll('.fin-card-link[data-env-id]').forEach(card => {
    const go = () => {
      const envelope = state.envelopes.find(e => e.id === card.dataset.envId);
      if (envelope) navigateTo('finance-envelope', { envelope });
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}


function renderBanksList() {
  const grid = document.getElementById('fin-banks-grid');
  const totalEl = document.getElementById('fin-banks-total');
  if (!grid) return;
  const banks = state.banks;
  const total = banks.reduce((s, b) => s + (Number(b.current_balance) || 0), 0);
  if (totalEl) totalEl.innerHTML = banks.length ? `الإجمالي: ${finPriv(finFmt(total) + ' ' + FIN_CUR)}` : '';
  if (!banks.length) {
    grid.innerHTML = `<div class="fin-empty">مفيش بنوك لسه — <span class="fin-empty-link" data-fin-open="manage-banks">أضف بنك</span></div>`;
    return;
  }
  grid.innerHTML = banks.map(b => {
    const bal = Number(b.current_balance) || 0;
    return `<div class="fin-card fin-card-link" data-bank-id="${b.id}" role="button" tabindex="0">
      ${finBadge(b.icon || '🏦', finColorFor(b))}
      <div class="fin-card-info">
        <span class="fin-card-name">${escapeHtml(b.name || '')}</span>
        <span class="fin-card-balance ${bal < 0 ? 'is-neg' : ''}">${finPriv(finFmt(bal))}<span class="fin-cur">${FIN_CUR}</span></span>
      </div>
      <span class="fin-card-arrow">←</span>
    </div>`;
  }).join('');
  grid.querySelectorAll('.fin-card-link[data-bank-id]').forEach(card => {
    const go = () => {
      const bank = state.banks.find(b => b.id === card.dataset.bankId);
      if (bank) navigateTo('finance-bank', { bank });
    };
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}
// kept for any legacy calls (manage modal re-render)
function renderBanksBox() { renderBanksList(); }

function renderBankDetail() {
  if (state.view !== 'finance-bank') return;
  const bank = state.banks.find(b => b.id === state.bank?.id) || state.bank;
  if (!bank) { navigateTo('finance-banks'); return; }
  state.bank = bank;

  const titleEl = document.getElementById('fin-bank-title');
  if (titleEl) titleEl.textContent = `${bank.icon || '🏦'} ${bank.name || ''}`;

  const bal   = Number(bank.current_balance) || 0;
  const txAll = state.transactions.filter(t => t.bankId === bank.id);
  const income = txAll.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const statsEl = document.getElementById('fin-bank-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="fin-stat-card">
      <div class="fin-stat-label">الرصيد الحالي</div>
      <div class="fin-stat-val ${bal < 0 ? 'is-neg' : 'is-pos'} privacy-sensitive">${finFmt(bal)} <span class="fin-stat-unit">${FIN_CUR}</span></div>
    </div>
    <div class="fin-stat-card">
      <div class="fin-stat-label">إجمالي الدخل</div>
      <div class="fin-stat-val is-pos privacy-sensitive">${finFmt(income)} <span class="fin-stat-unit">${FIN_CUR}</span></div>
    </div>
    <div class="fin-stat-card">
      <div class="fin-stat-label">عدد الحركات</div>
      <div class="fin-stat-val">${txAll.length}</div>
    </div>`;

  renderBankFeed();
}

function renderBankFeed() {
  const list = document.getElementById('fin-bank-feed-list');
  if (!list || !state.bank) return;
  const { type: fType, from: fFrom, to: fTo } = state.finBankFilter;
  let txs = state.transactions.filter(t => t.bankId === state.bank.id)
    .sort((a, b) => finTsMillis(b.createdAt) - finTsMillis(a.createdAt));
  if (fType !== 'all') txs = txs.filter(t => t.type === fType);
  if (fFrom)           txs = txs.filter(t => finTsMillis(t.createdAt) >= fFrom);
  if (fTo)             txs = txs.filter(t => finTsMillis(t.createdAt) <= fTo + 86399999);

  document.querySelectorAll('#fin-bank-feed-filters .fin-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filterType === fType);
  });

  if (!txs.length) {
    list.innerHTML = `<div class="fin-empty">${state.transactions.filter(t => t.bankId === state.bank.id).length ? 'مفيش حركات بهذا الفلتر' : 'مفيش حركات لهذا البنك لسه'}</div>`;
    return;
  }
  const envName = id => state.envelopes.find(e => e.id === id)?.name || '—';
  list.innerHTML = txs.map(t => {
    const income = t.type === 'income';
    const typeLabel = income
      ? ({ salary: 'مرتب 💼', freelance: 'فريلانس 🧑‍💻', normal: 'دخل عادي 💵' }[t.incomeType] || 'دخل')
      : (t.note || 'مصروف');
    const dest = income ? 'دخل' : escapeHtml(envName(t.envelopeId));
    return `<div class="fin-feed-row" data-tx-id="${t.id}">
      <span class="fin-feed-icon ${income ? 'income' : 'expense'}">${income ? '＋' : '－'}</span>
      <div class="fin-feed-main">
        <div class="fin-feed-title">${escapeHtml(typeLabel)}</div>
        <div class="fin-feed-meta">${dest} · ${escapeHtml(formatDate(t.createdAt))}</div>
      </div>
      <div class="fin-feed-amount ${income ? 'income' : 'expense'}">${income ? '+' : '−'}${finPriv(finFmt(t.amount))}</div>
      <div class="fin-feed-actions">
        <button class="fin-feed-act-btn" data-edit-tx="${t.id}" title="تعديل">✏️</button>
        <button class="fin-feed-act-btn del" data-del-tx="${t.id}" title="حذف">🗑</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-del-tx]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteTx(btn.dataset.delTx); });
  });
  list.querySelectorAll('[data-edit-tx]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditTxModal(btn.dataset.editTx); });
  });
}

function finPricePerGram(karat) {
  const p = state.goldPrices;
  if (!p) return 0;
  return Number(p['p' + karat]) || 0;
}
function renderGoldBox() {
  const summaryEl = document.getElementById('fin-gold-summary');
  const assetsEl  = document.getElementById('fin-gold-assets-list');
  if (!summaryEl) return;
  const byK = { 24: 0, 21: 0, 18: 0 };
  state.goldAssets.forEach(a => {
    const k = Number(a.karat);
    if (byK[k] !== undefined) byK[k] += Number(a.grams_owned) || 0;
  });
  const totalGrams = byK[24] + byK[21] + byK[18];
  const totalValue = byK[24] * finPricePerGram(24) + byK[21] * finPricePerGram(21) + byK[18] * finPricePerGram(18);
  const hasPrices = !!(finPricePerGram(24) || finPricePerGram(21) || finPricePerGram(18));

  const karatCards = [24, 21, 18].filter(k => byK[k] > 0).map(k => `
    <div class="fin-stat-card">
      <div class="fin-stat-label">عيار ${k}</div>
      <div class="fin-stat-val privacy-sensitive">${finFmt(byK[k])} <span class="fin-stat-unit">جم</span></div>
      ${hasPrices ? `<div class="fin-stat-sub privacy-sensitive">≈ ${finFmt(byK[k] * finPricePerGram(k))} ${FIN_CUR}</div>` : ''}
    </div>`).join('');

  summaryEl.innerHTML = `
    <div class="fin-section" style="padding-top:12px">
      <div class="fin-section-header">
        <span class="fin-section-icon">🥇</span>
        <h3 class="fin-section-title">الملخص</h3>
      </div>
      <div class="fin-stats-grid">
        <div class="fin-stat-card">
          <div class="fin-stat-label">إجمالي القيمة</div>
          <div class="fin-stat-val privacy-sensitive" style="color:#F0A835">${hasPrices ? finFmt(totalValue) : '—'} <span class="fin-stat-unit">${hasPrices ? FIN_CUR : ''}</span></div>
        </div>
        <div class="fin-stat-card">
          <div class="fin-stat-label">إجمالي الجرامات</div>
          <div class="fin-stat-val privacy-sensitive">${finFmt(totalGrams)} <span class="fin-stat-unit">جم</span></div>
        </div>
        ${karatCards}
        ${!hasPrices ? `<div class="fin-stat-card fin-stat-card--muted"><div class="fin-stat-label">حدّد الأسعار لعرض القيمة</div></div>` : ''}
      </div>
      <div class="fin-gold-actions" style="margin-top:12px">
        <button class="fin-gold-btn add" id="fin-gold-add" type="button">＋ إضافة</button>
        <button class="fin-gold-btn sub" id="fin-gold-sub" type="button">－ سحب</button>
      </div>
    </div>`;

  if (assetsEl) {
    if (!state.goldAssets.length) {
      assetsEl.innerHTML = `<div class="fin-empty">مفيش قطع مسجّلة لسه</div>`;
    } else {
      assetsEl.innerHTML = `<div class="fin-gold-asset-list">` +
        state.goldAssets
          .sort((a, b) => Number(b.karat) - Number(a.karat))
          .map(a => {
            const grams = Number(a.grams_owned) || 0;
            const val   = grams * finPricePerGram(Number(a.karat));
            return `<div class="fin-gold-asset-card">
              <div class="fin-gold-asset-karat">ع${a.karat}</div>
              <div class="fin-gold-asset-info">
                <div class="fin-gold-asset-name">${a.notes ? escapeHtml(a.notes) : 'سبيكة عيار ' + a.karat}</div>
                <div class="fin-gold-asset-date">${a.purchase_date || ''}</div>
              </div>
              <div class="fin-gold-asset-val">
                <div class="privacy-sensitive">${finFmt(grams)} جم</div>
                ${hasPrices ? `<div class="fin-gold-asset-price privacy-sensitive">≈ ${finFmt(val)} ${FIN_CUR}</div>` : ''}
              </div>
            </div>`;
          }).join('') +
        `</div>`;
    }
  }
}

function renderFeedBox() {
  const list = document.getElementById('fin-feed-list');
  if (!list) return;

  const { type: fType, from: fFrom, to: fTo } = state.finFilter;
  let txs = [...state.transactions]
    .sort((a, b) => finTsMillis(b.createdAt) - finTsMillis(a.createdAt));

  if (fType !== 'all') txs = txs.filter(t => t.type === fType);
  if (fFrom)           txs = txs.filter(t => finTsMillis(t.createdAt) >= fFrom);
  if (fTo)             txs = txs.filter(t => finTsMillis(t.createdAt) <= fTo + 86399999);

  // sync filter pill active states
  document.querySelectorAll('#fin-feed-filters .fin-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filterType === fType);
  });

  if (!txs.length) {
    list.innerHTML = `<div class="fin-empty">${state.transactions.length ? 'مفيش حركات بهذا الفلتر' : 'مفيش حركات لسه'}</div>`;
    return;
  }
  const bankName = id => state.banks.find(b => b.id === id)?.name || '—';
  const envName  = id => state.envelopes.find(e => e.id === id)?.name || '—';
  list.innerHTML = txs.map(t => {
    const income = t.type === 'income';
    const typeLabel = income
      ? ({ salary: 'مرتب 💼', freelance: 'فريلانس 🧑‍💻', normal: 'دخل عادي 💵' }[t.incomeType] || 'دخل')
      : (t.note || 'مصروف');
    const dest = income
      ? `إلى ${escapeHtml(bankName(t.bankId))}`
      : `${escapeHtml(envName(t.envelopeId))} · ${escapeHtml(bankName(t.bankId))}`;
    const pending = income && t.incomeType === 'normal' && !t.allocated;
    const dateStr = formatDate(t.createdAt);
    return `<div class="fin-feed-row${pending ? ' is-pending' : ''}"${pending ? ` data-fin-alloc="${t.id}" style="cursor:pointer"` : ''}>
      <span class="fin-feed-icon ${income ? 'income' : 'expense'}">${income ? '＋' : '－'}</span>
      <div class="fin-feed-main">
        <div class="fin-feed-title">${escapeHtml(typeLabel)}${pending ? '<span class="fin-feed-pending">يحتاج توزيع</span>' : ''}</div>
        <div class="fin-feed-meta">${dest} · ${escapeHtml(dateStr)}</div>
      </div>
      <div class="fin-feed-amount ${income ? 'income' : 'expense'}">${income ? '+' : '−'}${finPriv(finFmt(t.amount))}</div>
    </div>`;
  }).join('');
}

// ── Envelope Detail Page ──────────────────────────────────────
function renderEnvelopeDetail() {
  if (state.view !== 'finance-envelope') return;
  // Always use fresh envelope data from state
  const env = state.envelopes.find(e => e.id === state.envelope?.id) || state.envelope;
  if (!env) { navigateTo('finance'); return; }
  state.envelope = env;

  const titleEl = document.getElementById('fin-env-title');
  if (titleEl) titleEl.textContent = (env.icon || '✉️') + '  ' + (env.name || 'ظرف');

  // ── Stats row ──
  const statsEl = document.getElementById('fin-env-stats');
  if (statsEl) {
    const remaining = Number(env.current_balance) || 0;
    const budget    = Number(env.budget) || 0;
    const spent     = budget > 0 ? Math.max(0, budget - remaining) : null;
    statsEl.innerHTML = `
      <div class="fin-detail-stat">
        <span class="fin-detail-stat-label">المتاح للصرف</span>
        <span class="fin-detail-stat-value ${remaining < 0 ? 'is-neg' : 'is-pos'} privacy-sensitive">${finFmt(remaining)}<span class="fin-cur"> ${FIN_CUR}</span></span>
      </div>
      ${budget > 0 ? `
      <div class="fin-detail-stat">
        <span class="fin-detail-stat-label">الميزانية الكلية</span>
        <span class="fin-detail-stat-value privacy-sensitive">${finFmt(budget)}<span class="fin-cur"> ${FIN_CUR}</span></span>
      </div>
      <div class="fin-detail-stat">
        <span class="fin-detail-stat-label">تم الصرف</span>
        <span class="fin-detail-stat-value privacy-sensitive">${finFmt(spent)}<span class="fin-cur"> ${FIN_CUR}</span></span>
      </div>` : ''}
    `;
  }

  // ── Progress bar ──
  const progressWrap = document.getElementById('fin-env-progress-wrap');
  if (progressWrap) {
    const bal    = Number(env.current_balance) || 0;
    const budget = Number(env.budget) || 0;
    if (budget > 0) {
      const pct    = Math.min(100, Math.round((bal / budget) * 100));
      const pctCls = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'ok';
      progressWrap.innerHTML = `
        <div class="fin-env-prog-bar"><div class="fin-env-prog-fill ${pctCls}" style="width:${pct}%"></div></div>
        <span class="fin-env-prog-label">${pct}% من الميزانية مستخدم</span>
      `;
      progressWrap.classList.remove('hidden');
    } else {
      progressWrap.classList.add('hidden');
    }
  }

  renderEnvItems(env);
  renderEnvFeed(env);
}

// ── Envelope item (debt / goal) helpers ──
// Legacy items stored a decrementing `amount`; new items store the original
// `total` plus a `payments[]` log. These read either shape safely.
const itemTotal     = it => Number(it.total ?? it.amount) || 0;
const itemPayments  = it => (Array.isArray(it.payments) ? it.payments : []);
const itemPaid      = it => itemPayments(it).reduce((s, p) => s + (Number(p.amount) || 0), 0);
const itemRemaining = it => Math.max(0, +(itemTotal(it) - itemPaid(it)).toFixed(2));

function renderEnvItems(env) {
  const listEl  = document.getElementById('fin-env-items-list');
  const totalEl = document.getElementById('fin-env-items-total');
  if (!listEl) return;
  const items = Array.isArray(env.items) ? env.items : [];
  const totalRemaining = items.reduce((s, it) => s + itemRemaining(it), 0);
  if (totalEl) totalEl.textContent = items.length ? `متبقّي: ${finFmt(totalRemaining)} ${FIN_CUR}` : '';
  if (!items.length) {
    listEl.innerHTML = `<div class="fin-empty">مفيش بنود لسه — أضف بند (زي دين أو هدف) وسجّل سداداته</div>`;
    return;
  }
  listEl.innerHTML = items.map((it) => {
    const total = itemTotal(it), paid = itemPaid(it), remaining = itemRemaining(it);
    const pct  = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
    const done = total > 0 && remaining <= 0.005;
    const pays = itemPayments(it).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return `
    <div class="fin-item-card ${done ? 'is-done' : ''}" data-item-id="${it.id}">
      <div class="fin-item-head">
        <span class="fin-item-name">${escapeHtml(it.name || '')}${done ? ' <span class="fin-item-done-badge">مسدَّد ✓</span>' : ''}</span>
        <span class="fin-item-remain privacy-sensitive">${finFmt(remaining)}<span class="fin-item-of"> / ${finFmt(total)} ${FIN_CUR}</span></span>
      </div>
      <div class="fin-item-prog"><div class="fin-item-prog-fill ${done ? 'done' : ''}" style="width:${pct}%"></div></div>
      <div class="fin-item-foot">
        ${done ? '' : `<button class="fin-item-pay" type="button" data-item-id="${it.id}">＋ سداد</button>`}
        <span class="fin-item-meta">${pays.length ? `${pays.length} دفعة · اتسدّد <span class="privacy-sensitive">${finFmt(paid)} ${FIN_CUR}</span>` : 'مفيش سداد لسه'}</span>
        ${pays.length ? `<button class="fin-item-toggle" type="button" data-item-id="${it.id}" aria-expanded="false">السجل ▾</button>` : ''}
        <button class="fin-feed-act-btn fin-item-edit" type="button" data-item-id="${it.id}" title="تعديل">✏️</button>
        <button class="fin-feed-act-btn del fin-item-del" type="button" data-item-id="${it.id}" title="حذف">🗑</button>
      </div>
      ${pays.length ? `<div class="fin-item-pays hidden" data-pays-for="${it.id}">
        ${pays.map(p => `<div class="fin-item-pay-row">
          <span class="fin-item-pay-to">↳ ${escapeHtml(p.to || '—')}</span>
          <span class="fin-item-pay-amt privacy-sensitive">${finFmt(p.amount)} ${FIN_CUR}</span>
          <span class="fin-item-pay-date">${escapeHtml(formatDate(p.ts))}</span>
        </div>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('');

  listEl.querySelectorAll('.fin-item-pay').forEach(b => b.addEventListener('click', () => openEnvItemPayModal(b.dataset.itemId)));
  listEl.querySelectorAll('.fin-item-edit').forEach(b => b.addEventListener('click', () => openEnvItemModal(b.dataset.itemId)));
  listEl.querySelectorAll('.fin-item-toggle').forEach(b => b.addEventListener('click', () => {
    const box = listEl.querySelector(`.fin-item-pays[data-pays-for="${b.dataset.itemId}"]`);
    if (!box) return;
    const nowHidden = box.classList.toggle('hidden');
    b.setAttribute('aria-expanded', String(!nowHidden));
    b.textContent = nowHidden ? 'السجل ▾' : 'السجل ▴';
  }));
  listEl.querySelectorAll('.fin-item-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const it = items.find(x => x.id === btn.dataset.itemId);
      const confirmed = await confirmDialog({ title: 'حذف البند', message: `هتحذف "${it?.name}" وكل سجل سداده؟`, icon: '🗑️', confirmText: 'احذف' });
      if (!confirmed) return;
      const newItems = items.filter(x => x.id !== btn.dataset.itemId);
      try {
        await updateDoc(envelopeDoc(env.id), { items: newItems });
        toast('تم حذف البند', 'success');
      } catch (err) { toast('فشل الحذف', 'error'); console.error(err); }
    });
  });
}

function openEnvItemPayModal(itemId) {
  const env = state.envelope;
  if (!env) return;
  const it = (Array.isArray(env.items) ? env.items : []).find(i => i.id === itemId);
  if (!it) return;
  if (!state.banks.length) { toast('أضف بنك الأول من «إدارة»', 'error'); return; }
  const remaining = itemRemaining(it);
  document.getElementById('env-pay-item-id').value = itemId;
  document.getElementById('env-pay-info').innerHTML =
    `<strong>${escapeHtml(it.name || '')}</strong> — المتبقّي <b>${finFmt(remaining)} ${FIN_CUR}</b> · رصيد الظرف ${finFmt(env.current_balance || 0)} ${FIN_CUR}`;
  document.getElementById('env-pay-amount').value = '';
  document.getElementById('env-pay-to').value = '';
  document.getElementById('env-pay-bank').innerHTML = state.banks
    .map(b => `<option value="${b.id}">${escapeHtml((b.icon || '') + ' ' + b.name)}</option>`).join('');
  finShow('env-pay-modal-overlay');
  setTimeout(() => document.getElementById('env-pay-amount').focus(), 60);
}

async function submitEnvItemPay(e) {
  e.preventDefault();
  const env = state.envelope;
  if (!env) return;
  const itemId = document.getElementById('env-pay-item-id').value;
  const amount = Number(document.getElementById('env-pay-amount').value);
  const to     = document.getElementById('env-pay-to').value.trim();
  const bankId = document.getElementById('env-pay-bank').value;
  const items  = Array.isArray(env.items) ? env.items : [];
  const it     = items.find(i => i.id === itemId);
  if (!it) { toast('البند اتحذف', 'error'); return; }
  if (!(amount > 0)) { toast('حط مبلغ صحيح', 'error'); return; }
  if (!to) { toast('اكتب السداد راح لمين', 'error'); return; }
  const remaining = itemRemaining(it);
  if (amount > remaining + 0.005) { toast(`المبلغ أكبر من متبقّي البند (${finFmt(remaining)})`, 'error'); return; }
  // ⛔ Behavioral block — can't pay more than the envelope holds
  if (amount > (Number(env.current_balance) || 0) + 0.005) {
    toast(`🚫 رصيد ظرف «${env.name}» مايكفيش للسداد`, 'error');
    return;
  }
  const bank = state.banks.find(b => b.id === bankId);
  if (bank && amount > (Number(bank.current_balance) || 0) + 0.005) {
    toast(`⚠️ تنبيه: رصيد بنك «${bank.name}» أقل من المبلغ`, 'info');
  }
  const btn = document.getElementById('submit-env-pay-btn');
  btn.disabled = true;
  try {
    const payment = { id: Date.now().toString(36), amount: +amount.toFixed(2), to, bankId, ts: Date.now() };
    const newItems = items.map(i => i.id === itemId
      ? { ...i, total: itemTotal(i), payments: [...itemPayments(i), payment] }
      : i);
    const batch = writeBatch(db);
    batch.update(envelopeDoc(env.id), { current_balance: increment(-amount), items: newItems });
    batch.update(bankDoc(bankId), { current_balance: increment(-amount) });
    const txRef = doc(transactionsRef());
    batch.set(txRef, {
      type: 'expense', amount, bankId, envelopeId: env.id, itemId, paymentId: payment.id,
      note: `سداد ${it.name} — ${to}`, period: finThisPeriod(), createdAt: serverTimestamp(),
    });
    await batch.commit();
    toast('تم تسجيل السداد 💳', 'success');
    finHide('env-pay-modal-overlay');
  } catch (err) {
    console.error('submitEnvItemPay', err);
    toast('فشل تسجيل السداد', 'error');
  }
  btn.disabled = false;
}

function renderEnvFeed(env) {
  const listEl = document.getElementById('fin-env-feed-list');
  if (!listEl) return;
  const fType = state.finEnvFilter?.type || 'all';

  // sync pills
  document.querySelectorAll('#fin-env-filter-pills .fin-filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filterType === fType);
  });

  let txs = state.transactions.filter(t => {
    if (t.type === 'expense') return t.envelopeId === env.id;
    if (t.type === 'income' && Array.isArray(t.allocations)) {
      return t.allocations.some(a => a.envelopeId === env.id);
    }
    return false;
  }).sort((a, b) => finTsMillis(b.createdAt) - finTsMillis(a.createdAt));

  if (fType !== 'all') txs = txs.filter(t => t.type === fType);

  if (!txs.length) {
    listEl.innerHTML = `<div class="fin-empty">لا توجد حركات لهذا الظرف</div>`;
    return;
  }
  const bankName = id => state.banks.find(b => b.id === id)?.name || '—';
  listEl.innerHTML = txs.map(t => {
    const income = t.type === 'income';
    const typeLabel = income
      ? ({ salary: 'مرتب 💼', freelance: 'فريلانس 🧑‍💻', normal: 'دخل عادي 💵' }[t.incomeType] || 'دخل')
      : (t.note || 'مصروف');
    const allocAmt = income && Array.isArray(t.allocations)
      ? (t.allocations.find(a => a.envelopeId === env.id)?.amount ?? t.amount)
      : t.amount;
    return `<div class="fin-feed-row" data-tx-id="${t.id}">
      <span class="fin-feed-icon ${income ? 'income' : 'expense'}">${income ? '＋' : '－'}</span>
      <div class="fin-feed-main">
        <div class="fin-feed-title">${escapeHtml(typeLabel)}</div>
        <div class="fin-feed-meta">${escapeHtml(bankName(t.bankId))} · ${escapeHtml(formatDate(t.createdAt))}</div>
      </div>
      <div class="fin-feed-amount ${income ? 'income' : 'expense'}">${income ? '+' : '−'}${finPriv(finFmt(allocAmt))}</div>
      <div class="fin-feed-actions">
        <button class="fin-feed-act-btn" data-edit-tx="${t.id}" title="تعديل">✏️</button>
        <button class="fin-feed-act-btn del" data-del-tx="${t.id}" title="حذف">🗑</button>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('[data-del-tx]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteTx(btn.dataset.delTx); });
  });
  listEl.querySelectorAll('[data-edit-tx]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditTxModal(btn.dataset.editTx); });
  });
}

// ── Income (manual entry + auto allocation) ────────────────────
function updateIncomeTypeHint() {
  const t = document.getElementById('income-type')?.value;
  const hint = document.getElementById('income-type-hint');
  if (!hint) return;
  if (t === 'normal') {
    hint.textContent = 'هيتطلب منك توزيع المبلغ يدوياً على الأظرف فوراً.';
    return;
  }
  const rule = (state.allocRules[t] || []).filter(r => Number(r.percent) > 0);
  const sum = rule.reduce((s, r) => s + Number(r.percent), 0);
  if (!rule.length || Math.round(sum) !== 100) {
    hint.innerHTML = `⚠️ مفيش قاعدة ${t === 'salary' ? 'مرتب' : 'فريلانس'} مظبوطة (لازم 100%). عدّلها من «القواعد».`;
  } else {
    hint.textContent = `هيتوزع تلقائياً على ${rule.length} ظرف حسب القاعدة.`;
  }
}
function openIncomeModal() {
  if (!state.banks.length) { toast('أضف بنك الأول من «إدارة»', 'error'); return; }
  const bankSel = document.getElementById('income-bank');
  bankSel.innerHTML = state.banks.map(b => `<option value="${b.id}">${escapeHtml((b.icon || '') + ' ' + b.name)}</option>`).join('');
  document.getElementById('income-amount').value = '';
  document.getElementById('income-type-pills').querySelectorAll('.fin-type-pill')
    .forEach(p => p.classList.toggle('active', p.dataset.type === 'salary'));
  document.getElementById('income-type').value = 'salary';
  updateIncomeTypeHint();
  finShow('income-modal-overlay');
  setTimeout(() => document.getElementById('income-amount')?.focus(), 60);
}
async function submitIncome(e) {
  e.preventDefault();
  const amount = Number(document.getElementById('income-amount').value);
  const bankId = document.getElementById('income-bank').value;
  const type = document.getElementById('income-type').value;
  if (!(amount > 0)) { toast('حط مبلغ صحيح', 'error'); return; }
  if (!bankId) { toast('اختار البنك', 'error'); return; }
  const btn = document.getElementById('submit-income-btn');
  btn.disabled = true;
  try {
    if (type === 'salary' || type === 'freelance') {
      const rule = (state.allocRules[type] || []).filter(r => Number(r.percent) > 0 && state.envelopes.find(e => e.id === r.envelopeId));
      const sum = rule.reduce((s, r) => s + Number(r.percent), 0);
      if (!rule.length || Math.round(sum) !== 100) {
        toast('قاعدة التوزيع لازم تكون 100% على أظرف موجودة — عدّلها من «القواعد»', 'error');
        btn.disabled = false; return;
      }
      // Cut each envelope by its percentage (rounded to piaster), then route
      // any rounding remainder to the "unallocated funds catcher" (صائد الكسور)
      // — falls back to the last rule envelope when no catcher is configured.
      const allocMap = new Map();
      let allocated = 0;
      rule.forEach(r => {
        const amt = +(amount * r.percent / 100).toFixed(2);
        allocMap.set(r.envelopeId, +((allocMap.get(r.envelopeId) || 0) + amt).toFixed(2));
        allocated = +(allocated + amt).toFixed(2);
      });
      const remainder = +(amount - allocated).toFixed(2);
      if (Math.abs(remainder) >= 0.005) {
        const catcherId = state.finSettings?.unallocatedEnvelopeId;
        const target = (catcherId && state.envelopes.find(e => e.id === catcherId))
          ? catcherId
          : rule[rule.length - 1].envelopeId;
        allocMap.set(target, +((allocMap.get(target) || 0) + remainder).toFixed(2));
      }
      const allocations = [...allocMap.entries()].map(([envelopeId, amt]) => ({ envelopeId, amount: amt }));
      const batch = writeBatch(db);
      batch.update(bankDoc(bankId), { current_balance: increment(amount) });
      allocations.forEach(a => batch.update(envelopeDoc(a.envelopeId), { current_balance: increment(a.amount) }));
      const txRef = doc(transactionsRef());
      batch.set(txRef, { type: 'income', amount, bankId, incomeType: type, allocated: true, allocations, period: finThisPeriod(), createdAt: serverTimestamp() });
      await batch.commit();
      toast('تم تسجيل الدخل وتوزيعه ✅', 'success');
      finHide('income-modal-overlay');
    } else {
      // Normal — lands in bank, frozen until manual 100% allocation
      const batch = writeBatch(db);
      batch.update(bankDoc(bankId), { current_balance: increment(amount) });
      const txRef = doc(transactionsRef());
      batch.set(txRef, { type: 'income', amount, bankId, incomeType: 'normal', allocated: false, allocations: [], period: finThisPeriod(), createdAt: serverTimestamp() });
      await batch.commit();
      finHide('income-modal-overlay');
      openManualAlloc(txRef.id, amount);
    }
  } catch (err) {
    console.error(err);
    toast('فشل حفظ الدخل', 'error');
  }
  btn.disabled = false;
}

// ── Forced manual allocation (Normal income) ──────────────────
function openManualAlloc(txId, amount) {
  if (!state.envelopes.length) { toast('لازم تضيف أظرف الأول عشان توزع', 'error'); return; }
  state.pendingIncomeTxId = txId;
  state.pendingIncomeAmount = amount;
  document.getElementById('alloc-total-display').textContent = finFmt(amount) + ' ' + FIN_CUR;
  document.getElementById('alloc-rows').innerHTML = state.envelopes.map(env => `
    <div class="fin-alloc-row">
      <span class="fin-alloc-label">${escapeHtml(env.icon || '✉️')} ${escapeHtml(env.name)}</span>
      <input type="number" class="form-input fin-alloc-input" data-env="${env.id}" min="0" step="0.01" inputmode="decimal" placeholder="0">
    </div>`).join('');
  updateAllocRemaining();
  finShow('alloc-modal-overlay');
}
function updateAllocRemaining() {
  let sum = 0;
  document.querySelectorAll('#alloc-rows .fin-alloc-input').forEach(i => sum += Number(i.value) || 0);
  const remaining = +(state.pendingIncomeAmount - sum).toFixed(2);
  const el = document.getElementById('alloc-remaining');
  el.textContent = finFmt(remaining) + ' ' + FIN_CUR;
  el.className = Math.abs(remaining) < 0.005 ? 'ok' : 'bad';
  document.getElementById('submit-alloc-btn').disabled = Math.abs(remaining) >= 0.005;
}
// Dump whatever is still unallocated into the catcher envelope's input
// (صائد الكسور) — falls back to the first envelope when none is configured.
function fillAllocCatcher() {
  const inputs = [...document.querySelectorAll('#alloc-rows .fin-alloc-input')];
  if (!inputs.length) return;
  let sum = 0;
  inputs.forEach(i => sum += Number(i.value) || 0);
  const remaining = +(state.pendingIncomeAmount - sum).toFixed(2);
  if (remaining <= 0.005) { toast('مفيش باقي للتوزيع', 'info'); return; }
  const catcherId = state.finSettings?.unallocatedEnvelopeId;
  let target = inputs.find(i => i.dataset.env === catcherId) || inputs[0];
  target.value = +((Number(target.value) || 0) + remaining).toFixed(2);
  updateAllocRemaining();
}
async function submitManualAlloc() {
  const inputs = [...document.querySelectorAll('#alloc-rows .fin-alloc-input')];
  const allocations = inputs
    .map(i => ({ envelopeId: i.dataset.env, amount: +(Number(i.value) || 0).toFixed(2) }))
    .filter(a => a.amount > 0);
  const sum = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(sum - state.pendingIncomeAmount) >= 0.005) { toast('لازم توزع كامل المبلغ', 'error'); return; }
  const btn = document.getElementById('submit-alloc-btn');
  btn.disabled = true;
  try {
    const batch = writeBatch(db);
    allocations.forEach(a => {
      if (state.envelopes.find(e => e.id === a.envelopeId)) batch.update(envelopeDoc(a.envelopeId), { current_balance: increment(a.amount) });
    });
    batch.update(transactionDoc(state.pendingIncomeTxId), { allocated: true, allocations });
    await batch.commit();
    toast('تم التوزيع ✅', 'success');
    finHide('alloc-modal-overlay');
    state.pendingIncomeTxId = null;
  } catch (err) {
    console.error(err);
    toast('فشل التوزيع', 'error');
    btn.disabled = false;
  }
}

// ── Expense (behavioral block on envelope overspend) ──────────
function updateExpenseHint() {
  const env = state.envelopes.find(e => e.id === document.getElementById('expense-envelope').value);
  const hint = document.getElementById('expense-envelope-hint');
  if (env && hint) hint.textContent = `رصيد الظرف: ${finFmt(env.current_balance || 0)} ${FIN_CUR}`;
  // Update بند dropdown
  const itemGroup = document.getElementById('expense-item-group');
  const itemSel   = document.getElementById('expense-item');
  const items = Array.isArray(env?.items) ? env.items : [];
  if (items.length && itemGroup && itemSel) {
    itemSel.innerHTML = items.map(it => {
      const rem = itemRemaining(it);
      return `<option value="${it.id}">${escapeHtml(it.name || '')}${itemTotal(it) ? ' — متبقّي ' + finFmt(rem) + ' ' + FIN_CUR : ''}</option>`;
    }).join('');
    itemGroup.style.display = '';
  } else if (itemGroup) {
    itemGroup.style.display = 'none';
  }
}
function openExpenseModal() {
  if (!state.envelopes.length) { toast('أضف أظرف الأول من «إدارة»', 'error'); return; }
  if (!state.banks.length) { toast('أضف بنك الأول من «إدارة»', 'error'); return; }
  document.getElementById('expense-envelope').innerHTML = state.envelopes
    .map(env => `<option value="${env.id}">${escapeHtml((env.icon || '') + ' ' + env.name)} — ${finFmt(env.current_balance || 0)}</option>`).join('');
  document.getElementById('expense-bank').innerHTML = state.banks
    .map(b => `<option value="${b.id}">${escapeHtml((b.icon || '') + ' ' + b.name)}</option>`).join('');
  document.getElementById('expense-amount').value = '';
  document.getElementById('expense-note').value = '';
  updateExpenseHint();
  finShow('expense-modal-overlay');
  setTimeout(() => document.getElementById('expense-amount')?.focus(), 60);
}
async function deleteTx(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;
  const label = tx.type === 'income' ? 'دخل' : 'مصروف';
  const confirmed = await confirmDialog({
    title: `حذف ${label}`,
    message: `هتحذف ${label} بقيمة ${finFmt(tx.amount)} ${FIN_CUR}. الحذف مش هيتراجع — هيتم عكس الأرصدة تلقائياً.`,
    icon: '🗑️',
    confirmText: 'نعم، احذف',
  });
  if (!confirmed) return;
  try {
    const batch = writeBatch(db);
    if (tx.type === 'expense') {
      batch.update(bankDoc(tx.bankId), { current_balance: increment(tx.amount) });
      if (tx.envelopeId) {
        const env = state.envelopes.find(e => e.id === tx.envelopeId);
        const envRestore = { current_balance: increment(tx.amount) };
        if (tx.itemId && env) {
          envRestore.items = (Array.isArray(env.items) ? env.items : []).map(it => {
            if (it.id !== tx.itemId) return it;
            if (tx.paymentId) {
              // new model: drop the matching payment from the log
              return { ...it, total: itemTotal(it), payments: itemPayments(it).filter(p => p.id !== tx.paymentId) };
            }
            // legacy model: give the amount back
            return { ...it, amount: (Number(it.amount) || 0) + tx.amount };
          });
        }
        batch.update(envelopeDoc(tx.envelopeId), envRestore);
      }
    } else if (tx.type === 'income') {
      batch.update(bankDoc(tx.bankId), { current_balance: increment(-tx.amount) });
      if (Array.isArray(tx.allocations)) {
        tx.allocations.forEach(a => {
          if (a.envelopeId) batch.update(envelopeDoc(a.envelopeId), { current_balance: increment(-a.amount) });
        });
      }
    }
    batch.delete(transactionDoc(txId));
    await batch.commit();
    toast('تم الحذف', 'success');
  } catch (err) {
    console.error('deleteTx', err);
    toast('حصل خطأ أثناء الحذف', 'error');
  }
}

function openEditTxModal(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;
  document.getElementById('edit-tx-id').value   = txId;
  document.getElementById('edit-tx-note').value = tx.note || '';
  const envGroup = document.getElementById('edit-tx-envelope-group');
  const envSel   = document.getElementById('edit-tx-envelope');
  if (tx.type === 'expense') {
    envGroup.style.display = '';
    envSel.innerHTML = state.envelopes.map(e =>
      `<option value="${e.id}"${e.id === tx.envelopeId ? ' selected' : ''}>${escapeHtml((e.icon||'') + ' ' + e.name)}</option>`
    ).join('');
  } else {
    envGroup.style.display = 'none';
  }
  document.getElementById('edit-tx-modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('edit-tx-note').focus(), 60);
}

async function submitEditTx(e) {
  e.preventDefault();
  const txId = document.getElementById('edit-tx-id').value;
  const tx   = state.transactions.find(t => t.id === txId);
  if (!tx || !txId) return;
  const note      = document.getElementById('edit-tx-note').value.trim();
  const envelopeId = tx.type === 'expense' ? document.getElementById('edit-tx-envelope').value : tx.envelopeId;
  const btn = document.getElementById('submit-edit-tx-btn');
  btn.disabled = true;
  try {
    const updates = { note };
    if (tx.type === 'expense' && envelopeId !== tx.envelopeId) {
      // move expense between envelopes: reverse old, apply new
      const batch = writeBatch(db);
      if (tx.envelopeId) batch.update(envelopeDoc(tx.envelopeId), { current_balance: increment(tx.amount) });
      batch.update(envelopeDoc(envelopeId), { current_balance: increment(-tx.amount) });
      batch.update(transactionDoc(txId), { note, envelopeId });
      await batch.commit();
    } else {
      await updateDoc(transactionDoc(txId), updates);
    }
    document.getElementById('edit-tx-modal-overlay').classList.add('hidden');
    toast('تم التعديل', 'success');
  } catch (err) {
    console.error('submitEditTx', err);
    toast('حصل خطأ', 'error');
  } finally {
    btn.disabled = false;
  }
}

function openEnvItemModal(itemId) {
  const editId = document.getElementById('env-item-edit-id');
  const nameInp = document.getElementById('env-item-name-inp');
  const amtInp  = document.getElementById('env-item-amount-inp');
  const title   = document.querySelector('#env-item-modal-overlay h2');
  const submitBtn = document.getElementById('submit-env-item-btn');
  if (itemId) {
    const item = (state.envelope?.items || []).find(i => i.id === itemId);
    editId.value    = itemId;
    nameInp.value   = item?.name || '';
    amtInp.value    = item ? itemTotal(item) : '';
    if (title)     title.textContent  = '✏️ تعديل بند';
    if (submitBtn) submitBtn.textContent = 'حفظ التعديل';
  } else {
    editId.value = '';
    nameInp.value = '';
    amtInp.value  = '';
    if (title)     title.textContent  = '＋ إضافة بند';
    if (submitBtn) submitBtn.textContent = 'حفظ البند';
  }
  document.getElementById('env-item-modal-overlay').classList.remove('hidden');
  setTimeout(() => nameInp.focus(), 60);
}

async function submitExpense(e) {
  e.preventDefault();
  const amount = Number(document.getElementById('expense-amount').value);
  const envelopeId = document.getElementById('expense-envelope').value;
  const bankId = document.getElementById('expense-bank').value;
  const note = document.getElementById('expense-note').value.trim();
  const itemId = document.getElementById('expense-item')?.value || '';
  if (!(amount > 0)) { toast('حط مبلغ صحيح', 'error'); return; }
  const env = state.envelopes.find(e => e.id === envelopeId);
  if (!env) { toast('اختار ظرف', 'error'); return; }
  const envItems = Array.isArray(env.items) ? env.items : [];
  if (envItems.length && !itemId) { toast('اختار البند المناسب', 'error'); return; }
  if (itemId) {
    const it = envItems.find(i => i.id === itemId);
    if (it && amount > itemRemaining(it) + 0.005) { toast(`المبلغ أكبر من متبقّي البند (${finFmt(itemRemaining(it))})`, 'error'); return; }
  }
  // ⛔ Behavioral block — overspending a single envelope is forbidden outright
  if (amount > (Number(env.current_balance) || 0) + 0.005) {
    toast(`🚫 الصرف اتمنع — رصيد ظرف «${env.name}» مايكفيش`, 'error');
    return;
  }
  const bank = state.banks.find(b => b.id === bankId);
  if (bank && amount > (Number(bank.current_balance) || 0) + 0.005) {
    toast(`⚠️ تنبيه: رصيد بنك «${bank.name}» أقل من المبلغ`, 'info');
  }
  const btn = document.getElementById('submit-expense-btn');
  btn.disabled = true;
  try {
    const batch = writeBatch(db);
    const envUpdate = { current_balance: increment(-amount) };
    let paymentId = null;
    if (itemId) {
      paymentId = Date.now().toString(36);
      const payment = { id: paymentId, amount: +amount.toFixed(2), to: note || '—', bankId, ts: Date.now() };
      envUpdate.items = envItems.map(it =>
        it.id === itemId ? { ...it, total: itemTotal(it), payments: [...itemPayments(it), payment] } : it
      );
    }
    batch.update(envelopeDoc(envelopeId), envUpdate);
    batch.update(bankDoc(bankId), { current_balance: increment(-amount) });
    const txRef = doc(transactionsRef());
    const txData = { type: 'expense', amount, bankId, envelopeId, note, period: finThisPeriod(), createdAt: serverTimestamp() };
    if (itemId) { txData.itemId = itemId; txData.paymentId = paymentId; }
    batch.set(txRef, txData);
    await batch.commit();
    toast('تم تسجيل المصروف', 'success');
    finHide('expense-modal-overlay');
  } catch (err) {
    console.error(err);
    toast('فشل تسجيل المصروف', 'error');
  }
  btn.disabled = false;
}

// ── Allocation rules editor ───────────────────────────────────
let finRulesTab = 'salary';
function openRulesModal(type) {
  if (!state.envelopes.length) { toast('أضف أظرف الأول من «إدارة»', 'error'); return; }
  finRulesTab = (type === 'freelance') ? 'freelance' : 'salary';
  document.querySelectorAll('.fin-rules-tab').forEach(t => t.classList.toggle('active', t.dataset.rule === finRulesTab));
  renderRulesRows();
  // Populate the "unallocated funds catcher" (صائد الكسور) selector
  const catcherSel = document.getElementById('rules-catcher-env');
  if (catcherSel) {
    catcherSel.innerHTML = `<option value="">— بدون (يروح لآخر ظرف) —</option>` +
      state.envelopes.map(e => `<option value="${e.id}">${escapeHtml((e.icon || '✉️') + ' ' + e.name)}</option>`).join('');
    catcherSel.value = state.finSettings?.unallocatedEnvelopeId || '';
  }
  finShow('rules-modal-overlay');
}
function renderRulesRows() {
  const rule = state.allocRules[finRulesTab] || [];
  document.getElementById('rules-rows').innerHTML = state.envelopes.map(env => {
    const r = rule.find(x => x.envelopeId === env.id);
    return `<div class="fin-alloc-row">
      <span class="fin-alloc-label">${escapeHtml(env.icon || '✉️')} ${escapeHtml(env.name)}</span>
      <input type="number" class="form-input fin-rule-input" data-env="${env.id}" min="0" max="100" step="1" inputmode="numeric" value="${r ? Number(r.percent) : ''}" placeholder="0">
      <span class="fin-alloc-suffix">%</span>
    </div>`;
  }).join('');
  updateRulesSum();
}
function updateRulesSum() {
  let sum = 0;
  document.querySelectorAll('#rules-rows .fin-rule-input').forEach(i => sum += Number(i.value) || 0);
  const el = document.getElementById('rules-sum');
  el.textContent = sum + '%';
  el.className = sum === 100 ? 'ok' : 'bad';
}
async function saveRules() {
  const inputs = [...document.querySelectorAll('#rules-rows .fin-rule-input')];
  const allocations = inputs
    .map(i => ({ envelopeId: i.dataset.env, percent: Number(i.value) || 0 }))
    .filter(a => a.percent > 0);
  const sum = allocations.reduce((s, a) => s + a.percent, 0);
  if (sum !== 100) { toast('مجموع النسب لازم يساوي 100%', 'error'); return; }
  const btn = document.getElementById('save-rules-btn');
  btn.disabled = true;
  try {
    await setDoc(allocRuleDoc(finRulesTab), { allocations, updatedAt: serverTimestamp() });
    // Persist the unallocated-funds catcher choice (صائد الكسور)
    const catcherId = document.getElementById('rules-catcher-env')?.value || null;
    await setDoc(finSettingsDoc(), { unallocatedEnvelopeId: catcherId }, { merge: true });
    toast('تم حفظ القاعدة ✅', 'success');
    finHide('rules-modal-overlay');
  } catch (err) {
    console.error(err);
    toast('فشل حفظ القاعدة', 'error');
  }
  btn.disabled = false;
}

// ── Manage banks & envelopes (CRUD) ───────────────────────────
let finManageTab = 'banks';
let finManageEditId = null;
function openManageModal(kind) {
  finManageTab = (kind === 'envelopes') ? 'envelopes' : 'banks';
  document.querySelectorAll('.fin-manage-tab').forEach(t => t.classList.toggle('active', t.dataset.kind === finManageTab));
  resetManageForm();
  renderManageList();
  finShow('manage-modal-overlay');
}
function renderManageColors(selected) {
  const wrap = document.getElementById('manage-colors');
  if (!wrap) return;
  const sel = selected || COLORS[0];
  document.getElementById('manage-color').value = sel;
  wrap.innerHTML = COLORS.map(c =>
    `<button type="button" class="fin-swatch${c === sel ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}" aria-label="لون"></button>`
  ).join('');
}
function resetManageForm() {
  finManageEditId = null;
  document.getElementById('manage-edit-id').value = '';
  document.getElementById('manage-icon').value = '';
  document.getElementById('manage-name').value = '';
  document.getElementById('manage-desc').value = '';
  document.getElementById('manage-submit-btn').textContent = 'إضافة';
  renderManageColors(COLORS[Math.floor(Math.random() * COLORS.length)]);
}
function renderManageList() {
  const items = finManageTab === 'banks' ? state.banks : state.envelopes;
  const list = document.getElementById('manage-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="fin-empty">مفيش ${finManageTab === 'banks' ? 'بنوك' : 'أظرف'} لسه</div>`;
    return;
  }
  list.innerHTML = items.map(it => `<div class="fin-manage-item">
    <span class="fin-mi-icon" style="background:${finHexA(finColorFor(it), .16)};border-color:${finHexA(finColorFor(it), .42)}">${escapeHtml(it.icon || (finManageTab === 'banks' ? '🏦' : '✉️'))}</span>
    <span class="fin-mi-name">${escapeHtml(it.name)}</span>
    <span class="fin-mi-bal">${finPriv(finFmt(it.current_balance || 0) + ' ' + FIN_CUR)}</span>
    <button class="fin-mi-action edit" type="button" data-mi-edit="${it.id}" title="تعديل">✏️</button>
    <button class="fin-mi-action del" type="button" data-mi-del="${it.id}" title="حذف">🗑️</button>
  </div>`).join('');
}
async function submitManage(e) {
  e.preventDefault();
  const name = document.getElementById('manage-name').value.trim();
  const icon = document.getElementById('manage-icon').value.trim();
  const desc = document.getElementById('manage-desc').value.trim();
  const color = document.getElementById('manage-color').value || COLORS[0];
  if (!name) { toast('اكتب الاسم', 'error'); return; }
  const btn = document.getElementById('manage-submit-btn');
  btn.disabled = true;
  try {
    if (finManageEditId) {
      const ref = finManageTab === 'banks' ? bankDoc(finManageEditId) : envelopeDoc(finManageEditId);
      await updateDoc(ref, { name, icon, description: desc, color });
      toast('تم التعديل', 'success');
    } else {
      const items = finManageTab === 'banks' ? state.banks : state.envelopes;
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);
      await addDoc(finManageTab === 'banks' ? banksRef() : envelopesRef(),
        { name, icon, description: desc, color, current_balance: 0, sortOrder: maxOrder + 1, createdAt: serverTimestamp() });
      toast('تمت الإضافة', 'success');
    }
    resetManageForm();
  } catch (err) {
    console.error(err);
    toast('فشل الحفظ', 'error');
  }
  btn.disabled = false;
}
function editManageItem(id) {
  const items = finManageTab === 'banks' ? state.banks : state.envelopes;
  const it = items.find(x => x.id === id);
  if (!it) return;
  finManageEditId = id;
  document.getElementById('manage-edit-id').value = id;
  document.getElementById('manage-icon').value = it.icon || '';
  document.getElementById('manage-name').value = it.name || '';
  document.getElementById('manage-desc').value = it.description || '';
  renderManageColors(finColorFor(it));
  document.getElementById('manage-submit-btn').textContent = 'حفظ التعديل';
  document.getElementById('manage-name').focus();
}
async function deleteManageItem(id) {
  const items = finManageTab === 'banks' ? state.banks : state.envelopes;
  const it = items.find(x => x.id === id);
  if (!it) return;
  const bal = Number(it.current_balance) || 0;
  const ok = await confirmDialog({
    title: `حذف ${finManageTab === 'banks' ? 'البنك' : 'الظرف'}`,
    message: `متأكد تحذف «${it.name}»؟${bal ? ` رصيده الحالي ${finFmt(bal)} ${FIN_CUR}.` : ''}`,
    confirmText: 'نعم، احذف',
  });
  if (!ok) return;
  try {
    await deleteDoc(finManageTab === 'banks' ? bankDoc(id) : envelopeDoc(id));
    toast('تم الحذف', 'success');
    if (finManageEditId === id) resetManageForm();
  } catch (err) {
    console.error(err);
    toast('فشل الحذف', 'error');
  }
}

// ── Gold prices (free API + manual fallback) ──────────────────
function openGoldPricesModal() {
  const p = state.goldPrices;
  document.getElementById('gold-price-24').value = p?.p24 ?? '';
  document.getElementById('gold-price-21').value = p?.p21 ?? '';
  document.getElementById('gold-price-18').value = p?.p18 ?? '';
  const note = document.getElementById('gold-prices-source-note');
  note.textContent = p?.updatedAt
    ? `آخر تحديث: ${formatDate(p.updatedAt)} (${p.source === 'api' ? 'تلقائي' : 'يدوي'})`
    : 'مفيش أسعار محفوظة — اضغط «جلب تلقائي» أو اكتبها يدوياً.';
  finShow('gold-prices-modal-overlay');
}
async function saveGoldPrices(e) {
  e.preventDefault();
  const p24 = Number(document.getElementById('gold-price-24').value) || 0;
  const p21 = Number(document.getElementById('gold-price-21').value) || 0;
  const p18 = Number(document.getElementById('gold-price-18').value) || 0;
  if (!(p24 || p21 || p18)) { toast('اكتب سعر واحد على الأقل', 'error'); return; }
  try {
    await setDoc(goldPricesDoc(), { p24, p21, p18, source: 'manual', updatedAt: serverTimestamp() });
    toast('تم حفظ الأسعار', 'success');
    finHide('gold-prices-modal-overlay');
  } catch (err) {
    console.error(err);
    toast('فشل الحفظ', 'error');
  }
}
async function fetchGoldPricesAuto() {
  const btn = document.getElementById('fin-gold-refresh-btn');
  const orig = btn.textContent;
  btn.textContent = '...'; btn.disabled = true;
  try {
    let usdPerOz = Number(sessionStorage.getItem('fin-gold-xau')) || null;
    if (!usdPerOz) {
      const res = await fetch('https://api.gold-api.com/price/XAU');
      if (!res.ok) throw new Error('api');
      const data = await res.json();
      usdPerOz = Number(data.price);
      if (usdPerOz) sessionStorage.setItem('fin-gold-xau', String(usdPerOz));
    }
    if (!usdPerOz) throw new Error('noprice');
    const usdEgp = Number(localStorage.getItem('fin-usd-egp')) || 50;
    const gram24 = usdPerOz / 31.1034768 * usdEgp;
    document.getElementById('gold-price-24').value = gram24.toFixed(2);
    document.getElementById('gold-price-21').value = (gram24 * 21 / 24).toFixed(2);
    document.getElementById('gold-price-18').value = (gram24 * 18 / 24).toFixed(2);
    toast('تم الجلب — راجع الأسعار وعدّل سعر الدولار لو محتاج ثم احفظ', 'info');
  } catch (err) {
    console.error('gold fetch', err);
    toast('تعذّر الجلب التلقائي — اكتب السعر يدوياً', 'error');
  }
  btn.textContent = orig; btn.disabled = false;
}

// ── Gold grams add / withdraw ─────────────────────────────────
let finGoldMode = 'add';
function openGoldGramsModal(mode) {
  finGoldMode = (mode === 'sub') ? 'sub' : 'add';
  document.getElementById('gold-grams-title').textContent = finGoldMode === 'add' ? '🥇 إضافة ذهب' : '🥇 سحب ذهب';
  document.getElementById('submit-gold-grams-btn').textContent = finGoldMode === 'add' ? 'إضافة' : 'سحب';
  document.getElementById('gold-grams').value = '';
  document.getElementById('gold-notes').value = '';
  document.getElementById('gold-karat-pills').querySelectorAll('.fin-type-pill')
    .forEach(p => p.classList.toggle('active', p.dataset.karat === '24'));
  document.getElementById('gold-karat').value = '24';
  document.getElementById('gold-notes').closest('.form-group').style.display = finGoldMode === 'add' ? '' : 'none';
  finShow('gold-grams-modal-overlay');
}
async function submitGoldGrams(e) {
  e.preventDefault();
  const karat = Number(document.getElementById('gold-karat').value);
  const grams = Number(document.getElementById('gold-grams').value);
  const notes = document.getElementById('gold-notes').value.trim();
  if (!(grams > 0)) { toast('حط عدد جرامات صحيح', 'error'); return; }
  const btn = document.getElementById('submit-gold-grams-btn');
  btn.disabled = true;
  try {
    if (finGoldMode === 'add') {
      await addDoc(goldAssetsRef(), { karat, grams_owned: grams, purchase_date: toLocalISODate(new Date()), notes, createdAt: serverTimestamp() });
      toast('تمت إضافة الذهب', 'success');
    } else {
      const assets = state.goldAssets
        .filter(a => Number(a.karat) === karat)
        .sort((a, b) => finTsMillis(a.createdAt) - finTsMillis(b.createdAt));
      const total = assets.reduce((s, a) => s + (Number(a.grams_owned) || 0), 0);
      if (grams > total + 0.0005) {
        toast(`🚫 معندكش غير ${finFmt(total)} جم من عيار ${karat}`, 'error');
        btn.disabled = false; return;
      }
      let remaining = grams;
      const batch = writeBatch(db);
      for (const a of assets) {
        if (remaining <= 0.0005) break;
        const have = Number(a.grams_owned) || 0;
        if (have <= remaining + 0.0005) { batch.delete(goldAssetDoc(a.id)); remaining -= have; }
        else { batch.update(goldAssetDoc(a.id), { grams_owned: +(have - remaining).toFixed(3) }); remaining = 0; }
      }
      await batch.commit();
      toast('تم سحب الذهب', 'success');
    }
    finHide('gold-grams-modal-overlay');
  } catch (err) {
    console.error(err);
    toast('فشل العملية', 'error');
  }
  btn.disabled = false;
}

// ── Generic pill selector wiring ──────────────────────────────
function bindFinPills(containerId, hiddenId, attr, onChange) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.addEventListener('click', e => {
    const pill = e.target.closest('.fin-type-pill');
    if (!pill) return;
    c.querySelectorAll('.fin-type-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    const hid = document.getElementById(hiddenId);
    if (hid) hid.value = pill.dataset[attr];
    if (onChange) onChange();
  });
}

// ════════════════════════════════════════════════════════════════
//  LIABILITIES (الالتزامات / الديون) — snowball debt tracking
// ════════════════════════════════════════════════════════════════
function renderLiabilities() {
  if (state.view !== 'finance-liabilities') return;
  const grid    = document.getElementById('fin-liabilities-grid');
  const totalEl = document.getElementById('fin-liabilities-total');
  const hintEl  = document.getElementById('fin-snowball-hint');
  if (!grid) return;

  // Snowball: sort by remaining ascending — smallest active debt first.
  const liabs = [...state.liabilities]
    .sort((a, b) => (Number(a.remaining_amount) || 0) - (Number(b.remaining_amount) || 0));
  const totalRemaining = liabs.reduce((s, l) => s + (Number(l.remaining_amount) || 0), 0);
  if (totalEl) totalEl.innerHTML = liabs.length ? `المتبقّي: ${finPriv(finFmt(totalRemaining) + ' ' + FIN_CUR)}` : '';

  const nextTarget = liabs.find(l => (Number(l.remaining_amount) || 0) > 0.005);
  if (hintEl) hintEl.innerHTML = nextTarget
    ? `❄️ طريقة كرة الثلج: ركّز على «${escapeHtml(nextTarget.name)}» — أصغر دين متبقّي، خلّصه الأول.`
    : (liabs.length ? '🎉 مفيش ديون متبقّية — كله متسدّد!' : '');

  if (!liabs.length) {
    grid.innerHTML = `<div class="fin-empty">مفيش التزامات لسه — أضف أول دين أو قسط من «التزام جديد»</div>`;
    return;
  }

  grid.innerHTML = liabs.map(l => {
    const total     = Number(l.total_amount) || 0;
    const remaining = Number(l.remaining_amount) || 0;
    const paid      = Math.max(0, total - remaining);
    const pct       = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
    const cleared   = remaining <= 0.005;
    const isNext    = nextTarget && l.id === nextTarget.id;
    const env       = state.envelopes.find(e => e.id === l.envelopeId);
    return `<div class="fin-card fin-liab-card${cleared ? ' is-cleared' : ''}${isNext ? ' is-next' : ''}" data-liab-id="${l.id}">
      <div class="fin-liab-head">
        ${finBadge(l.icon || '💳', finColorFor(l))}
        <div class="fin-card-info">
          <span class="fin-card-name">${escapeHtml(l.name || '')}${isNext ? '<span class="fin-liab-tag next">التالي ❄️</span>' : ''}${cleared ? '<span class="fin-liab-tag done">مسدَّد ✅</span>' : ''}</span>
          <span class="fin-card-sub">${env ? escapeHtml((env.icon || '✉️') + ' ' + env.name) : '⚠️ ظرف محذوف'}</span>
        </div>
        <div class="fin-liab-actions">
          <button class="fin-feed-act-btn fin-liab-edit" type="button" data-liab-id="${l.id}" title="تعديل">✏️</button>
          <button class="fin-feed-act-btn del fin-liab-del" type="button" data-liab-id="${l.id}" title="حذف">🗑</button>
        </div>
      </div>
      <div class="fin-liab-figs">
        <span class="fin-liab-remaining privacy-sensitive ${remaining > 0 ? 'is-neg' : 'is-pos'}">${finFmt(remaining)}<span class="fin-cur"> ${FIN_CUR}</span></span>
        <span class="fin-liab-of privacy-sensitive">من ${finFmt(total)}</span>
      </div>
      <div class="fin-card-prog"><div class="fin-card-prog-fill ${cleared ? 'ok' : 'accent'}" style="width:${pct}%"></div></div>
      <div class="fin-liab-foot">
        <span class="fin-liab-pct">${pct}% مسدَّد</span>
        ${cleared ? '' : `<button class="fin-btn fin-btn-expense fin-liab-pay" type="button" data-liab-id="${l.id}">💳 سداد قسط</button>`}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.fin-liab-pay').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openLiabilityPayModal(b.dataset.liabId); }));
  grid.querySelectorAll('.fin-liab-edit').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openLiabilityModal(b.dataset.liabId); }));
  grid.querySelectorAll('.fin-liab-del').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteLiability(b.dataset.liabId); }));
}

function openLiabilityModal(id) {
  if (!state.envelopes.length) { toast('أضف ظرف الأول عشان تربط بيه الالتزام', 'error'); return; }
  const title   = document.getElementById('liability-modal-title');
  const submit  = document.getElementById('submit-liability-btn');
  const remGroup = document.getElementById('liability-remaining-group');
  const envSel  = document.getElementById('liability-envelope');
  envSel.innerHTML = state.envelopes.map(e => `<option value="${e.id}">${escapeHtml((e.icon || '✉️') + ' ' + e.name)}</option>`).join('');
  const l = id ? state.liabilities.find(x => x.id === id) : null;
  document.getElementById('liability-edit-id').value = l ? l.id : '';
  document.getElementById('liability-icon').value    = l?.icon || '';
  document.getElementById('liability-name').value    = l?.name || '';
  document.getElementById('liability-total').value   = l ? (Number(l.total_amount) || 0) : '';
  document.getElementById('liability-remaining').value = l ? (Number(l.remaining_amount) || 0) : '';
  if (l) envSel.value = l.envelopeId || state.envelopes[0].id;
  // Remaining is editable only when editing an existing liability
  remGroup.style.display = l ? '' : 'none';
  if (title)  title.textContent  = l ? '✏️ تعديل التزام' : '＋ التزام جديد';
  if (submit) submit.textContent = l ? 'حفظ التعديل' : 'حفظ';
  finShow('liability-modal-overlay');
  setTimeout(() => document.getElementById('liability-name').focus(), 60);
}

async function submitLiability(e) {
  e.preventDefault();
  const id    = document.getElementById('liability-edit-id').value;
  const name  = document.getElementById('liability-name').value.trim();
  const icon  = document.getElementById('liability-icon').value.trim() || '💳';
  const total = Number(document.getElementById('liability-total').value);
  const envelopeId = document.getElementById('liability-envelope').value;
  if (!name) { toast('اكتب اسم الالتزام', 'error'); return; }
  if (!(total > 0)) { toast('حط إجمالي مبلغ صحيح', 'error'); return; }
  if (!envelopeId) { toast('اختار الظرف المرتبط', 'error'); return; }
  const btn = document.getElementById('submit-liability-btn');
  btn.disabled = true;
  try {
    if (id) {
      const remaining = Math.max(0, Number(document.getElementById('liability-remaining').value) || 0);
      await updateDoc(liabilityDoc(id), { name, icon, total_amount: total, remaining_amount: remaining, envelopeId });
      toast('تم تعديل الالتزام ✅', 'success');
    } else {
      await addDoc(liabilitiesRef(), {
        name, icon, total_amount: total, remaining_amount: total, envelopeId,
        color: finColorFor({ name }), sortOrder: state.liabilities.length, createdAt: serverTimestamp(),
      });
      toast('تم إضافة الالتزام ✅', 'success');
    }
    finHide('liability-modal-overlay');
  } catch (err) {
    console.error('submitLiability', err);
    toast('فشل حفظ الالتزام', 'error');
  }
  btn.disabled = false;
}

async function deleteLiability(id) {
  const l = state.liabilities.find(x => x.id === id);
  if (!l) return;
  const confirmed = await confirmDialog({
    title: 'حذف التزام',
    message: `هتحذف «${l.name}». ده مش هيرجّع أي أرصدة — بس بيشيل الالتزام من القائمة.`,
    icon: '🗑️', confirmText: 'نعم، احذف',
  });
  if (!confirmed) return;
  try {
    await deleteDoc(liabilityDoc(id));
    toast('تم حذف الالتزام', 'success');
  } catch (err) {
    console.error('deleteLiability', err);
    toast('فشل الحذف', 'error');
  }
}

function openLiabilityPayModal(id) {
  const l = state.liabilities.find(x => x.id === id);
  if (!l) return;
  if (!state.banks.length) { toast('أضف بنك الأول من «إدارة»', 'error'); return; }
  const env = state.envelopes.find(e => e.id === l.envelopeId);
  const remaining = Number(l.remaining_amount) || 0;
  document.getElementById('liability-pay-id').value = id;
  document.getElementById('liability-pay-info').innerHTML =
    `«${escapeHtml(l.name)}» — المتبقّي <strong class="privacy-sensitive">${finFmt(remaining)} ${FIN_CUR}</strong>`
    + `<br>هيتخصم من ظرف ${env ? escapeHtml((env.icon || '✉️') + ' ' + env.name) : '—'} (المتاح: <span class="privacy-sensitive">${finFmt(Number(env?.current_balance) || 0)}</span>)`;
  document.getElementById('liability-pay-amount').value = '';
  document.getElementById('liability-pay-note').value = '';
  document.getElementById('liability-pay-bank').innerHTML = state.banks
    .map(b => `<option value="${b.id}">${escapeHtml((b.icon || '🏦') + ' ' + b.name)}</option>`).join('');
  finShow('liability-pay-modal-overlay');
  setTimeout(() => document.getElementById('liability-pay-amount').focus(), 60);
}

async function submitLiabilityPay(e) {
  e.preventDefault();
  const id     = document.getElementById('liability-pay-id').value;
  const amount = Number(document.getElementById('liability-pay-amount').value);
  const bankId = document.getElementById('liability-pay-bank').value;
  const note   = document.getElementById('liability-pay-note').value.trim();
  const l = state.liabilities.find(x => x.id === id);
  if (!l) return;
  if (!(amount > 0)) { toast('حط مبلغ صحيح', 'error'); return; }
  const remaining = Number(l.remaining_amount) || 0;
  if (amount > remaining + 0.005) { toast(`المبلغ أكبر من المتبقّي (${finFmt(remaining)})`, 'error'); return; }
  const env = state.envelopes.find(x => x.id === l.envelopeId);
  if (!env) { toast('الظرف المرتبط اتحذف — عدّل الالتزام الأول', 'error'); return; }
  // ⛔ Behavioral block — can't pay more than the linked envelope holds
  if (amount > (Number(env.current_balance) || 0) + 0.005) {
    toast(`🚫 رصيد ظرف «${env.name}» مايكفيش للسداد`, 'error');
    return;
  }
  const btn = document.getElementById('submit-liability-pay-btn');
  btn.disabled = true;
  try {
    const batch = writeBatch(db);
    batch.update(envelopeDoc(env.id), { current_balance: increment(-amount) });
    batch.update(bankDoc(bankId), { current_balance: increment(-amount) });
    batch.update(liabilityDoc(id), { remaining_amount: Math.max(0, +(remaining - amount).toFixed(2)) });
    const txRef = doc(transactionsRef());
    batch.set(txRef, {
      type: 'expense', amount, bankId, envelopeId: env.id, liabilityId: id,
      note: note || `سداد قسط: ${l.name}`, period: finThisPeriod(), createdAt: serverTimestamp(),
    });
    await batch.commit();
    toast('تم تسجيل السداد 💳', 'success');
    finHide('liability-pay-modal-overlay');
  } catch (err) {
    console.error('submitLiabilityPay', err);
    toast('فشل تسجيل السداد', 'error');
  }
  btn.disabled = false;
}

// ── Event bindings (static elements exist from page load) ─────
(function bindFinanceUI() {
  // Toolbar
  document.getElementById('btn-fin-income')?.addEventListener('click', openIncomeModal);
  document.getElementById('btn-fin-expense')?.addEventListener('click', openExpenseModal);
  document.getElementById('btn-env-expense')?.addEventListener('click', () => {
    openExpenseModal();
    // pre-select the current envelope
    setTimeout(() => {
      const sel = document.getElementById('expense-envelope');
      if (sel && state.envelope) sel.value = state.envelope.id;
      updateExpenseHint();
    }, 80);
  });
  document.getElementById('btn-fin-manage')?.addEventListener('click', () => openManageModal('banks'));
  document.getElementById('btn-fin-rules')?.addEventListener('click', () => openRulesModal('salary'));
  document.getElementById('btn-fin-privacy')?.addEventListener('click', toggleFinPrivacy);
  document.getElementById('fin-gold-prices-btn')?.addEventListener('click', openGoldPricesModal);
  document.getElementById('view-finance-gold')?.addEventListener('click', e => {
    if (e.target.closest('#fin-gold-add')) { openGoldGramsModal('add'); return; }
    if (e.target.closest('#fin-gold-sub')) { openGoldGramsModal('sub'); return; }
  });

  // Forms
  document.getElementById('income-form')?.addEventListener('submit', submitIncome);
  document.getElementById('expense-form')?.addEventListener('submit', submitExpense);
  document.getElementById('gold-prices-form')?.addEventListener('submit', saveGoldPrices);
  document.getElementById('gold-grams-form')?.addEventListener('submit', submitGoldGrams);
  document.getElementById('manage-form')?.addEventListener('submit', submitManage);
  document.getElementById('submit-alloc-btn')?.addEventListener('click', submitManualAlloc);
  document.getElementById('alloc-fill-catcher')?.addEventListener('click', fillAllocCatcher);
  document.getElementById('save-rules-btn')?.addEventListener('click', saveRules);
  document.getElementById('fin-gold-refresh-btn')?.addEventListener('click', fetchGoldPricesAuto);
  document.getElementById('expense-envelope')?.addEventListener('change', updateExpenseHint);

  // Pills
  bindFinPills('income-type-pills', 'income-type', 'type', updateIncomeTypeHint);
  bindFinPills('gold-karat-pills', 'gold-karat', 'karat');

  // Close / cancel buttons → hide their overlay
  const closeMap = {
    'close-income-modal-btn': 'income-modal-overlay', 'cancel-income-modal-btn': 'income-modal-overlay',
    'close-expense-modal-btn': 'expense-modal-overlay', 'cancel-expense-modal-btn': 'expense-modal-overlay',
    'close-rules-modal-btn': 'rules-modal-overlay', 'cancel-rules-modal-btn': 'rules-modal-overlay',
    'close-manage-modal-btn': 'manage-modal-overlay',
    'close-gold-prices-modal-btn': 'gold-prices-modal-overlay',
    'close-gold-grams-modal-btn': 'gold-grams-modal-overlay', 'cancel-gold-grams-modal-btn': 'gold-grams-modal-overlay',
    'close-liability-modal-btn': 'liability-modal-overlay', 'cancel-liability-modal-btn': 'liability-modal-overlay',
    'close-liability-pay-modal-btn': 'liability-pay-modal-overlay', 'cancel-liability-pay-modal-btn': 'liability-pay-modal-overlay',
  };
  Object.entries(closeMap).forEach(([btnId, ovId]) => {
    document.getElementById(btnId)?.addEventListener('click', () => finHide(ovId));
  });
  // Backdrop click closes the liability overlays
  ['liability-modal-overlay', 'liability-pay-modal-overlay'].forEach(ovId => {
    document.getElementById(ovId)?.addEventListener('click', e => { if (e.target === e.currentTarget) finHide(ovId); });
  });

  // Backdrop click closes (NOT the forced allocation modal)
  ['income-modal-overlay', 'expense-modal-overlay', 'rules-modal-overlay', 'manage-modal-overlay', 'gold-prices-modal-overlay', 'gold-grams-modal-overlay'].forEach(id => {
    const ov = document.getElementById(id);
    ov?.addEventListener('click', e => { if (e.target === ov) ov.classList.add('hidden'); });
  });

  // Live sums
  document.getElementById('alloc-rows')?.addEventListener('input', updateAllocRemaining);
  document.getElementById('rules-rows')?.addEventListener('input', updateRulesSum);

  // Rules tabs
  document.getElementById('rules-modal-overlay')?.addEventListener('click', e => {
    const tab = e.target.closest('.fin-rules-tab');
    if (!tab) return;
    finRulesTab = tab.dataset.rule;
    document.querySelectorAll('.fin-rules-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderRulesRows();
  });

  // Manage tabs + list actions
  document.getElementById('manage-modal-overlay')?.addEventListener('click', e => {
    const tab = e.target.closest('.fin-manage-tab');
    if (tab) {
      finManageTab = tab.dataset.kind;
      document.querySelectorAll('.fin-manage-tab').forEach(t => t.classList.toggle('active', t === tab));
      resetManageForm();
      renderManageList();
      return;
    }
    const swatch = e.target.closest('.fin-swatch');
    if (swatch) {
      document.getElementById('manage-color').value = swatch.dataset.color;
      document.querySelectorAll('#manage-colors .fin-swatch').forEach(s => s.classList.toggle('active', s === swatch));
      return;
    }
    const edit = e.target.closest('[data-mi-edit]');
    if (edit) { editManageItem(edit.dataset.miEdit); return; }
    const del = e.target.closest('[data-mi-del]');
    if (del) { deleteManageItem(del.dataset.miDel); return; }
  });

  // Delegated clicks inside the finance view (dynamic elements)
  document.getElementById('view-finance')?.addEventListener('click', e => {
    const allocRow = e.target.closest('[data-fin-alloc]');
    if (allocRow) {
      const tx = state.transactions.find(t => t.id === allocRow.dataset.finAlloc);
      if (tx) openManualAlloc(tx.id, Number(tx.amount) || 0);
      return;
    }
    const openLink = e.target.closest('[data-fin-open]');
    if (openLink) {
      if (openLink.dataset.finOpen === 'manage-envelopes') openManageModal('envelopes');
      else if (openLink.dataset.finOpen === 'manage-banks') openManageModal('banks');
      return;
    }
    if (e.target.closest('#fin-gold-add')) { openGoldGramsModal('add'); return; }
    if (e.target.closest('#fin-gold-sub')) { openGoldGramsModal('sub'); return; }
  });

  // ── Back buttons ──
  document.getElementById('btn-back-finance')?.addEventListener('click', () => navigateTo('dashboard'));
  document.getElementById('btn-back-finance-banks')?.addEventListener('click', () => navigateTo(state.financeBackTo || 'finance'));
  document.getElementById('btn-back-finance-bank')?.addEventListener('click',  () => navigateTo('finance-banks'));
  document.getElementById('btn-back-finance-envelopes')?.addEventListener('click', () => navigateTo(state.financeBackTo || 'finance'));
  document.getElementById('btn-back-finance-env')?.addEventListener('click',   () => navigateTo(state.financeEnvBackTo || 'finance-envelopes'));
  document.getElementById('btn-back-finance-gold')?.addEventListener('click',  () => navigateTo(state.financeBackTo || 'finance'));
  document.getElementById('btn-back-finance-summary')?.addEventListener('click', () => navigateTo('dashboard'));
  document.getElementById('btn-back-finance-liabilities')?.addEventListener('click', () => navigateTo('finance'));
  document.getElementById('btn-liability-add')?.addEventListener('click', () => openLiabilityModal());

  // ── Manage modal: restore all tabs on close ──
  const restoreManageTabs = () => {
    document.querySelectorAll('.fin-manage-tab').forEach(t => { t.style.display = ''; });
  };
  document.getElementById('close-manage-modal-btn')?.addEventListener('click', restoreManageTabs, true);

  // ── Banks page: add bank (show only banks tab) ──
  document.getElementById('btn-banks-add')?.addEventListener('click', () => {
    finManageTab = 'banks';
    document.querySelectorAll('.fin-manage-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.kind === 'banks');
      t.style.display = t.dataset.kind === 'envelopes' ? 'none' : '';
    });
    resetManageForm();
    renderManageList();
    finShow('manage-modal-overlay');
  });

  // ── Envelopes page: add envelope (show only envelopes tab) ──
  document.getElementById('btn-envelopes-add')?.addEventListener('click', () => {
    finManageTab = 'envelopes';
    document.querySelectorAll('.fin-manage-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.kind === 'envelopes');
      t.style.display = t.dataset.kind === 'banks' ? 'none' : '';
    });
    resetManageForm();
    renderManageList();
    finShow('manage-modal-overlay');
  });
  document.getElementById('btn-envelopes-rules')?.addEventListener('click', openRulesModal);

  // ── Privacy toggles (all fin sub-view privacy btns) ──
  document.querySelectorAll('.fin-priv-toggle').forEach(btn => btn.addEventListener('click', toggleFinPrivacy));

  // ── Bank detail feed filter pills ──
  document.getElementById('fin-bank-feed-filters')?.addEventListener('click', e => {
    const pill = e.target.closest('.fin-filter-pill');
    if (!pill) return;
    state.finBankFilter.type = pill.dataset.filterType || 'all';
    debounceRender(renderBankFeed);
  });
  document.getElementById('fin-bank-filter-from')?.addEventListener('change', e => {
    state.finBankFilter.from = e.target.value ? new Date(e.target.value).getTime() : null;
    debounceRender(renderBankFeed);
  });
  document.getElementById('fin-bank-filter-to')?.addEventListener('change', e => {
    state.finBankFilter.to = e.target.value ? new Date(e.target.value).getTime() : null;
    debounceRender(renderBankFeed);
  });
  document.getElementById('fin-bank-filter-clear')?.addEventListener('click', () => {
    state.finBankFilter = { type: 'all', from: null, to: null };
    const f = document.getElementById('fin-bank-filter-from');
    const t = document.getElementById('fin-bank-filter-to');
    if (f) f.value = '';
    if (t) t.value = '';
    debounceRender(renderBankFeed);
  });

  // ── Envelope detail: feed filter pills ──
  document.getElementById('fin-env-filter-pills')?.addEventListener('click', e => {
    const pill = e.target.closest('.fin-filter-pill');
    if (!pill) return;
    state.finEnvFilter.type = pill.dataset.filterType || 'all';
    if (state.envelope) renderEnvFeed(state.envelope);
  });

  // ── Envelope detail: add item button → modal ──
  document.getElementById('btn-add-env-item')?.addEventListener('click', () => openEnvItemModal(null));

  // ── Add/Edit env item modal ──
  const closeEnvItemModal = () => document.getElementById('env-item-modal-overlay').classList.add('hidden');
  document.getElementById('close-env-item-modal-btn')?.addEventListener('click', closeEnvItemModal);
  document.getElementById('cancel-env-item-modal-btn')?.addEventListener('click', closeEnvItemModal);
  document.getElementById('env-item-modal-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeEnvItemModal(); });

  document.getElementById('env-item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.envelope) return;
    const name   = document.getElementById('env-item-name-inp').value.trim();
    const total  = Number(document.getElementById('env-item-amount-inp').value) || 0;
    const editId = document.getElementById('env-item-edit-id').value;
    if (!name) return;
    const btn = document.getElementById('submit-env-item-btn');
    btn.disabled = true;
    try {
      const existing = Array.isArray(state.envelope.items) ? [...state.envelope.items] : [];
      if (editId) {
        const idx = existing.findIndex(i => i.id === editId);
        // keep the payment log; drop the legacy `amount` in favour of `total`
        if (idx >= 0) { const { amount, ...rest } = existing[idx]; existing[idx] = { ...rest, name, total, payments: itemPayments(existing[idx]) }; }
      } else {
        existing.push({ id: Date.now().toString(36), name, total, payments: [] });
      }
      await updateDoc(envelopeDoc(state.envelope.id), { items: existing });
      closeEnvItemModal();
      toast(editId ? 'تم تعديل البند' : 'تم إضافة البند', 'success');
    } catch (err) { toast('فشلت العملية', 'error'); console.error(err); }
    btn.disabled = false;
  });

  // ── Envelope item: pay (سداد) modal ──
  const closeEnvPayModal = () => document.getElementById('env-pay-modal-overlay').classList.add('hidden');
  document.getElementById('close-env-pay-modal-btn')?.addEventListener('click', closeEnvPayModal);
  document.getElementById('cancel-env-pay-modal-btn')?.addEventListener('click', closeEnvPayModal);
  document.getElementById('env-pay-modal-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeEnvPayModal(); });
  document.getElementById('env-pay-form')?.addEventListener('submit', submitEnvItemPay);

  // ── Edit transaction modal ──
  const closeEditTxModal = () => document.getElementById('edit-tx-modal-overlay').classList.add('hidden');
  document.getElementById('close-edit-tx-modal-btn')?.addEventListener('click', closeEditTxModal);
  document.getElementById('cancel-edit-tx-modal-btn')?.addEventListener('click', closeEditTxModal);
  document.getElementById('edit-tx-modal-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeEditTxModal(); });
  document.getElementById('edit-tx-form')?.addEventListener('submit', submitEditTx);
  document.getElementById('liability-form')?.addEventListener('submit', submitLiability);
  document.getElementById('liability-pay-form')?.addEventListener('submit', submitLiabilityPay);

})();
