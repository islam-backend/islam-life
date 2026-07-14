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

// ── Focus Timer Refs ───────────────────────────────────────────
const focusSessionsRef     = ()                => collection(db, 'focusSessions');
const activeFocusSessionDoc = ()               => doc(db, 'meta', 'activeFocusSession');

// ── Finance Center Refs (المركز المالي) ───────────────────────
const accountsRef      = ()      => collection(db, 'accounts');
const categoriesRef    = ()      => collection(db, 'budgetCategories');
const goalsRef         = ()      => collection(db, 'goals');
const debtsRef         = ()      => collection(db, 'debts');
const assetsRef        = ()      => collection(db, 'assets');
const goldAssetsRef    = ()      => collection(db, 'gold_assets');
const transactionsRef  = ()      => collection(db, 'transactions');
const accountDoc       = (id)    => doc(db, 'accounts', id);
const categoryDoc      = (id)    => doc(db, 'budgetCategories', id);
const goalDoc          = (id)    => doc(db, 'goals', id);
const debtDoc          = (id)    => doc(db, 'debts', id);
const assetDoc         = (id)    => doc(db, 'assets', id);
const goldAssetDoc     = (id)    => doc(db, 'gold_assets', id);
const transactionDoc   = (id)    => doc(db, 'transactions', id);
const planDoc          = ()      => doc(db, 'meta', 'plan');             // { income, percents{...} }
const goldPricesDoc    = ()      => doc(db, 'meta', 'goldPrices');
const finSettingsDoc   = ()      => doc(db, 'meta', 'finSettings');       // { targetMonths, nisabGrams, usdEgp, zakatDueDate }

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
  // Focus timer (Pomodoro v1)
  focus: {
    active:      false,
    preset:      null,   // 'quick' | 'deep'
    phase:       null,   // 'work' | 'break'
    phaseStartedAt:   0, // ms epoch
    phaseDurationSec: 0,
    pausedAt:         null, // ms epoch or null when running
    accumulatedPauseSec: 0,
    tickInterval:     null,
    restored:         false, // guards restoreActiveFocusSessionOnLoad from re-running its Firestore read
  },
  // Calendar state (v9.2)
  calendarCursor:       null,     // Date pointing at the displayed month
  dayDate:              null,     // Date selected for day-details view
  // Finance Center state (المركز المالي) — rebuilt v4.0
  accounts:     [],
  categories:   [],              // monthly budget buckets
  goals:        [],
  debts:        [],
  assets:       [],              // investments (thndr / real-estate / funds)
  goldAssets:   [],              // physical gold (by karat/grams)
  transactions: [],
  plan:         null,            // { income, percents:{needs,debts,personal,emergency,sadaqah,invest} }
  goldPrices:   null,            // { p24, p21, p18, source, updatedAt }
  finSettings:  { targetMonths: 3, nisabGrams: 85, usdEgp: 50, zakatDueDate: null },
  finUnsub:     [],              // array of onSnapshot unsubscribers
  finPeriod:    finThisPeriod(), // selected month key 'YYYY-MM' (الفصل الشهري)
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

// ── Hub side-cards (prayer times / today's clients): collapsible, remembered ──
const HUB_COLLAPSE_KEY = 'hubCardCollapsed';
function hubLoadCollapsedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(HUB_COLLAPSE_KEY)) || []); }
  catch (e) { return new Set(); }
}
(function initHubCardCollapse() {
  const collapsed = hubLoadCollapsedSet();
  document.querySelectorAll('.hub-card[id]').forEach(card => {
    if (collapsed.has(card.id)) card.classList.add('is-collapsed');
  });
  document.querySelectorAll('.hub-card-head').forEach(head => {
    head.addEventListener('click', () => {
      const card = head.closest('.hub-card[id]');
      if (!card) return;
      card.classList.toggle('is-collapsed');
      const set = hubLoadCollapsedSet();
      if (card.classList.contains('is-collapsed')) set.add(card.id); else set.delete(card.id);
      localStorage.setItem(HUB_COLLAPSE_KEY, JSON.stringify([...set]));
    });
  });
})();

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

  if (view === 'dashboard') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-dashboard').classList.add('active');
    renderHub();
    loadPrayerTimes();
    subscribeDashboard();
    renderPomodoroWidget();
    restoreActiveFocusSessionOnLoad();

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
    state.client = null; state.project = null;
    document.getElementById('view-finance').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-budget') {
    state.client = null; state.project = null;
    document.getElementById('view-finance-budget').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-debts') {
    state.client = null; state.project = null;
    document.getElementById('view-finance-debts').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-goals') {
    state.client = null; state.project = null;
    document.getElementById('view-finance-goals').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-assets') {
    state.client = null; state.project = null;
    document.getElementById('view-finance-assets').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-zakat') {
    state.client = null; state.project = null;
    document.getElementById('view-finance-zakat').classList.add('active');
    subscribeFinance();

  } else if (view === 'finance-emergency') {
    state.client = null; state.project = null;
    document.getElementById('view-finance-emergency').classList.add('active');
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

  updateHeader();
  updateBreadcrumb();

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
//  FOCUS TIMER — Pomodoro v1 (hub side-card)
// ════════════════════════════════════════════════════════════════

const FOCUS_PRESETS = {
  quick: { label: '⚡ سريع 25/5', workMinutes: 25, breakMinutes: 5 },
  deep:  { label: '🎯 عميق 50/10', workMinutes: 50, breakMinutes: 10 },
};

function focusFmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// Remaining seconds in the current phase, computed from wall-clock
// timestamps (not a decremented counter) so background tabs / reloads
// never drift — the whole point of this being reload-safe.
function focusRemainingSec() {
  const f = state.focus;
  if (!f.active) return 0;
  const pausedExtra = f.pausedAt ? (Date.now() - f.pausedAt) / 1000 : 0;
  const elapsed = (Date.now() - f.phaseStartedAt) / 1000 - f.accumulatedPauseSec - pausedExtra;
  return f.phaseDurationSec - elapsed;
}

function focusStopTick() {
  if (state.focus.tickInterval) { clearInterval(state.focus.tickInterval); state.focus.tickInterval = null; }
}

function focusStartTick() {
  focusStopTick();
  state.focus.tickInterval = setInterval(() => {
    if (state.view !== 'dashboard') return;
    if (!state.focus.active || state.focus.pausedAt) { focusPaintRunning(); return; }
    const remaining = focusRemainingSec();
    if (remaining <= 0) { focusCompletePhase(); return; }
    focusPaintRunning();
  }, 250);
}

// Cheap per-tick DOM update — no full re-render of the widget.
function focusPaintRunning() {
  const countdownEl = document.getElementById('focus-countdown');
  const fillEl = document.getElementById('focus-progress-fill');
  if (!countdownEl) return;
  const remaining = Math.max(0, focusRemainingSec());
  countdownEl.textContent = focusFmtClock(remaining);
  if (fillEl) {
    const pct = state.focus.phaseDurationSec
      ? Math.min(100, Math.max(0, 100 - (remaining / state.focus.phaseDurationSec) * 100))
      : 0;
    fillEl.style.width = `${pct}%`;
  }
}

async function focusWriteActiveDoc() {
  const f = state.focus;
  await setDoc(activeFocusSessionDoc(), {
    active: f.active,
    preset: f.preset,
    phase: f.phase,
    phaseStartedAt: f.phaseStartedAt,
    phaseDurationSec: f.phaseDurationSec,
    pausedAt: f.pausedAt,
    accumulatedPauseSec: f.accumulatedPauseSec,
  });
}

async function startFocusSession(preset) {
  const cfg = FOCUS_PRESETS[preset];
  if (!cfg) return;
  Object.assign(state.focus, {
    active: true,
    preset,
    phase: 'work',
    phaseStartedAt: Date.now(),
    phaseDurationSec: cfg.workMinutes * 60,
    pausedAt: null,
    accumulatedPauseSec: 0,
  });
  renderPomodoroWidget();
  focusStartTick();
  try { await focusWriteActiveDoc(); } catch (e) { console.error('focus start:', e); }
}

async function pauseFocusSession() {
  const f = state.focus;
  if (!f.active || f.pausedAt) return;
  f.pausedAt = Date.now();
  renderPomodoroWidget();
  try { await focusWriteActiveDoc(); } catch (e) { console.error('focus pause:', e); }
}

async function resumeFocusSession() {
  const f = state.focus;
  if (!f.active || !f.pausedAt) return;
  f.accumulatedPauseSec += (Date.now() - f.pausedAt) / 1000;
  f.pausedAt = null;
  renderPomodoroWidget();
  try { await focusWriteActiveDoc(); } catch (e) { console.error('focus resume:', e); }
}

async function resetFocusSession() {
  Object.assign(state.focus, {
    active: false, preset: null, phase: null,
    phaseStartedAt: 0, phaseDurationSec: 0,
    pausedAt: null, accumulatedPauseSec: 0,
  });
  focusStopTick();
  renderPomodoroWidget();
  try { await setDoc(activeFocusSessionDoc(), { active: false }); } catch (e) { console.error('focus reset:', e); }
}

async function focusCompletePhase() {
  const f = state.focus;
  if (f.phase === 'work') {
    const cfg = FOCUS_PRESETS[f.preset];
    toast('انتهت فترة التركيز! خد استراحة ☕', 'success');
    Object.assign(f, {
      phase: 'break',
      phaseStartedAt: Date.now(),
      phaseDurationSec: cfg.breakMinutes * 60,
      pausedAt: null,
      accumulatedPauseSec: 0,
    });
    renderPomodoroWidget();
    try { await focusWriteActiveDoc(); } catch (e) { console.error('focus phase advance:', e); }
  } else {
    await focusCompleteSession();
  }
}

async function focusCompleteSession() {
  const f = state.focus;
  const cfg = FOCUS_PRESETS[f.preset];
  toast('جلسة تركيز خلصت 🎉', 'success');
  focusStopTick();
  try {
    await addDoc(focusSessionsRef(), {
      preset: f.preset,
      workMinutes: cfg.workMinutes,
      breakMinutes: cfg.breakMinutes,
      startedAt: new Date(f.phaseStartedAt - cfg.breakMinutes * 60000),
      completedAt: serverTimestamp(),
      phasesCompleted: 2,
      projectId: null,
      createdAt: serverTimestamp(),
    });
    await setDoc(activeFocusSessionDoc(), { active: false });
  } catch (e) { console.error('focus complete:', e); }
  Object.assign(f, {
    active: false, preset: null, phase: null,
    phaseStartedAt: 0, phaseDurationSec: 0,
    pausedAt: null, accumulatedPauseSec: 0,
  });
  renderPomodoroWidget();
}

function renderPomodoroWidget() {
  const body = document.getElementById('focus-body');
  const sub  = document.getElementById('focus-sub');
  if (!body) return;

  const f = state.focus;

  if (!f.active) {
    if (sub) sub.textContent = '';
    body.innerHTML = `
      <div class="focus-preset-row">
        <button class="premium-ide-btn is-primary" type="button" data-preset="quick">${FOCUS_PRESETS.quick.label}</button>
        <button class="premium-ide-btn is-primary" type="button" data-preset="deep">${FOCUS_PRESETS.deep.label}</button>
      </div>`;
    return;
  }

  const cfg = FOCUS_PRESETS[f.preset];
  if (sub) sub.textContent = f.phase === 'work' ? 'شغل' : 'استراحة';
  const remaining = Math.max(0, focusRemainingSec());
  const pct = f.phaseDurationSec ? Math.min(100, Math.max(0, 100 - (remaining / f.phaseDurationSec) * 100)) : 0;

  body.innerHTML = `
    <div class="focus-phase-label">${f.phase === 'work' ? '🎯 وقت التركيز' : '☕ وقت الراحة'} — ${cfg.label}</div>
    <div class="focus-countdown" id="focus-countdown">${focusFmtClock(remaining)}</div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-track"><div class="progress-bar-fill" id="focus-progress-fill" style="width:${pct}%; background:var(--accent);"></div></div>
    </div>
    <div class="focus-controls-row">
      <button class="premium-ide-btn" type="button" data-focus-action="${f.pausedAt ? 'resume' : 'pause'}">${f.pausedAt ? '▶️ استكمال' : '⏸️ إيقاف مؤقت'}</button>
      <button class="premium-ide-btn is-danger" type="button" data-focus-action="reset">إعادة تعيين</button>
    </div>`;
}

// One delegated listener handles both idle presets and running controls.
(function initFocusWidgetEvents() {
  const body = document.getElementById('focus-body');
  if (!body) return;
  body.addEventListener('click', (e) => {
    const presetBtn = e.target.closest('[data-preset]');
    if (presetBtn) { startFocusSession(presetBtn.dataset.preset); return; }
    const actionBtn = e.target.closest('[data-focus-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.focusAction;
    if (action === 'pause') pauseFocusSession();
    else if (action === 'resume') resumeFocusSession();
    else if (action === 'reset') resetFocusSession();
  });
})();

// Runs once at app boot: if a session was left running (e.g. the page was
// reloaded mid-timer), reconstruct it from Firestore instead of losing it.
async function restoreActiveFocusSessionOnLoad() {
  if (state.focus.restored) return;
  state.focus.restored = true;
  try {
    const snap = await getDoc(activeFocusSessionDoc());
    if (!snap.exists()) return;
    const data = snap.data();
    if (!data.active) return;
    Object.assign(state.focus, {
      active: true,
      preset: data.preset,
      phase: data.phase,
      phaseStartedAt: data.phaseStartedAt,
      phaseDurationSec: data.phaseDurationSec,
      pausedAt: data.pausedAt || null,
      accumulatedPauseSec: data.accumulatedPauseSec || 0,
    });
    const remaining = focusRemainingSec();
    if (remaining <= 0) { await focusCompletePhase(); return; }
    renderPomodoroWidget();
    focusStartTick();
  } catch (e) { console.error('focus restore:', e); }
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
      e.dataTransfer.setDragImage(FIN_DRAG_BLANK_IMG, 0, 0);
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
      e.dataTransfer.setDragImage(FIN_DRAG_BLANK_IMG, 0, 0);
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
// Swap the dragged card and the drop target in place — every other card
// keeps its position, only the two involved cards trade spots.
function reorderIdsForDrop(ids, draggedId, targetId) {
  const fromIdx = ids.indexOf(draggedId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return ids;
  const next = ids.slice();
  [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
  return next;
}

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

  const ids = sorted.map(item => item.id);
  if (!ids.includes(draggedId) || !ids.includes(targetId)) return;
  const byId = new Map(sorted.map(item => [item.id, item]));
  const orderedIds = reorderIdsForDrop(ids, draggedId, targetId);
  const reordered = orderedIds.map(id => byId.get(id));

  // Optimistic local update so the cards animate into place immediately,
  // the same instant feel as the finance-home card reorder.
  reordered.forEach((item, idx) => { item.order = idx; });
  if (type === 'client') {
    renderClients();
  } else {
    renderProjects();
  }

  const batch = writeBatch(db);
  reordered.forEach((item, idx) => {
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

  } else if (['finance','finance-budget','finance-debts','finance-goals','finance-assets','finance-zakat','finance-emergency'].includes(state.view)) {
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
  const finCrumbs = {
    'finance-budget': '🗂️ الميزانية الشهرية',
    'finance-debts':  '💳 الديون والالتزامات',
    'finance-goals':  '🎯 الأهداف',
    'finance-assets': '🥇 الأصول والذهب',
    'finance-zakat':  '🕌 الزكاة والصدقة',
    'finance-emergency': '🛟 صندوق الطوارئ',
  };
  if (finCrumbs[state.view]) {
    html += `<span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-link" data-to="finance">💰 المركز المالي</span>
             <span class="breadcrumb-sep">›</span>
             <span class="breadcrumb-current">${finCrumbs[state.view]}</span>`;
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
//  FINANCE CENTER (المركز المالي) — v4.0 rebuild
//  Plan-first money OS: Accounts · Budget · Debts · Goals · Assets ·
//  Gold · Emergency · Zakat · Net-worth & Health report.
//  Dynamic: everything scales from the user's live income & percents.
// ════════════════════════════════════════════════════════════════

const FIN_CUR = 'ج.م';

// Plan buckets (order = priority) — labels + colors + icons
const FIN_BUCKETS = [
  { key: 'needs',     label: 'احتياجات ومعيشة', icon: '🏠', color: '#3574F0' },
  { key: 'debts',     label: 'ديون والتزامات',  icon: '💳', color: '#E05C5C' },
  { key: 'emergency', label: 'صندوق الطوارئ',    icon: '🛟', color: '#1ABC9C' },
  { key: 'personal',  label: 'مصاريف شخصية',     icon: '🧍', color: '#F0A835' },
  { key: 'sadaqah',   label: 'صدقة وزكاة',       icon: '🕌', color: '#3DB981' },
  { key: 'invest',    label: 'استثمار وأهداف',   icon: '📈', color: '#9B59B6' },
];
const FIN_DEFAULT_PERCENTS = { needs: 55, debts: 12, emergency: 10, personal: 5, sadaqah: 3, invest: 15 };

// ── Small helpers (hoisted declarations — safe to call before block) ──
function finFmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function finRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function finPriv(inner) { return `<span class="privacy-sensitive">${inner}</span>`; }
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
function finTsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  const t = new Date(ts).getTime();
  return isNaN(t) ? 0 : t;
}
const finShow = (id) => document.getElementById(id)?.classList.remove('hidden');
const finHide = (id) => document.getElementById(id)?.classList.add('hidden');

// Monthly segregation helpers (period key 'YYYY-MM')
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
function finTxPeriod(t) { return t.period || finPeriodOf(t.createdAt); }
function finPeriodLabel(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return '—';
  return new Date(y, m - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
}
function finShiftPeriod(key, n) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(y, (m - 1) + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════
//  DERIVED VALUES (the calculation engines)
// ════════════════════════════════════════════════════════════════

function finPricePerGram(karat) {
  const p = state.goldPrices || {};
  if (karat === 24) return Number(p.p24) || 0;
  if (karat === 21) return Number(p.p21) || 0;
  if (karat === 18) return Number(p.p18) || 0;
  return 0;
}
function finGoldGrams() {
  const g = { 24: 0, 21: 0, 18: 0 };
  (state.goldAssets || []).forEach(a => {
    const k = Number(a.karat) || 24;
    if (g[k] === undefined) g[k] = 0;
    g[k] += Number(a.grams_owned) || 0;
  });
  return g;
}
function finGoldValue() {
  const g = finGoldGrams();
  return Object.keys(g).reduce((s, k) => s + g[k] * finPricePerGram(Number(k)), 0);
}
function finAccountsTotal() {
  return (state.accounts || []).reduce((s, a) => s + (Number(a.balance) || 0), 0);
}
function finEmergencyAccount() {
  return (state.accounts || []).find(a => a.isEmergency);
}
function finEmergencyBalance() {
  const acc = finEmergencyAccount();
  return acc ? (Number(acc.balance) || 0) : 0;
}
function finAssetsValue() {
  return (state.assets || []).reduce((s, a) => s + (Number(a.currentValue) || 0), 0);
}
// Cash-funded goals hold money set aside (outside accounts) → part of net worth.
function finCashGoalsSaved() {
  return (state.goals || [])
    .filter(g => (g.fundingType || 'cash') === 'cash')
    .reduce((s, g) => s + (Number(g.savedAmount) || 0), 0);
}
function finDebtsRemaining() {
  return (state.debts || []).reduce((s, d) => s + (Number(d.remaining) || 0), 0);
}
function finDebtsMonthlyMin() {
  return (state.debts || []).reduce((s, d) => s + (Number(d.monthlyMin) || 0), 0);
}
function finTotalAssets() {
  return finAccountsTotal() + finGoldValue() + finAssetsValue() + finCashGoalsSaved();
}
function finNetWorth() {
  return finTotalAssets() - finDebtsRemaining();
}
function finIncome() {
  return Number(state.plan?.income) || 0;
}
function finPercents() {
  const p = { ...FIN_DEFAULT_PERCENTS, ...(state.plan?.percents || {}) };
  return p;
}
function finPercentsSum() {
  const p = finPercents();
  return FIN_BUCKETS.reduce((s, b) => s + (Number(p[b.key]) || 0), 0);
}
// Recommended monthly EGP per bucket = percent × income.
function finPlanAmount(key) {
  return finRound2(finIncome() * (Number(finPercents()[key]) || 0) / 100);
}
// Monthly essentials = sum of budget-category targets, fallback to plan "needs" amount.
function finMonthlyEssential() {
  const cats = (state.categories || []).reduce((s, c) => s + (Number(c.target) || 0), 0);
  return cats > 0 ? cats : finPlanAmount('needs');
}
function finEmergencyTarget() {
  const months = Number(state.finSettings?.targetMonths) || 3;
  return finMonthlyEssential() * months;
}
function finEmergencyCoverage() {
  const ess = finMonthlyEssential();
  return ess > 0 ? finEmergencyBalance() / ess : 0;
}
function finCategorySpent(catId, period) {
  return (state.transactions || [])
    .filter(t => t.type === 'expense' && t.categoryId === catId && finTxPeriod(t) === period)
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
}
function finPeriodTotals(period) {
  let income = 0, expense = 0;
  (state.transactions || []).forEach(t => {
    if (finTxPeriod(t) !== period) return;
    if (t.type === 'income') income += Number(t.amount) || 0;
    else if (['expense', 'debtPayment', 'zakat', 'sadaqah'].includes(t.type)) expense += Number(t.amount) || 0;
  });
  return { income, expense, net: income - expense };
}
// Goal maths — required monthly + progress + status.
function finGoalValue(g) {
  if ((g.fundingType || 'cash') === 'asset' && g.linkedAssetId) {
    const a = (state.assets || []).find(x => x.id === g.linkedAssetId);
    if (a) return Number(a.currentValue) || 0;
  }
  return Number(g.savedAmount) || 0;
}
function finMonthsUntil(deadlineISO) {
  if (!deadlineISO) return null;
  const d = new Date(deadlineISO), now = new Date();
  const months = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
  return Math.max(0, months) + (d.getDate() >= now.getDate() ? 0 : 0);
}
function finGoalMonthlyNeed(g) {
  const remaining = Math.max(0, (Number(g.targetAmount) || 0) - finGoalValue(g));
  const months = finMonthsUntil(g.deadline);
  if (months === null) return null;
  if (months <= 0) return remaining;
  return finRound2(remaining / months);
}
// Zakat — nisab = 85g gold value; zakatable = gold + cash + liquid investments.
function finNisabValue() {
  const grams = Number(state.finSettings?.nisabGrams) || 85;
  const p24 = finPricePerGram(24);
  return grams * p24;
}
function finZakatableTotal() {
  const liquidAssets = (state.assets || [])
    .filter(a => a.type !== 'realestate')
    .reduce((s, a) => s + (Number(a.currentValue) || 0), 0);
  return finAccountsTotal() + finGoldValue() + liquidAssets;
}
function finHawlPassed() {
  const due = state.finSettings?.zakatDueDate;
  if (!due) return false;
  return new Date(due).getTime() <= Date.now();
}
function finZakatDue() {
  const total = finZakatableTotal();
  const nisab = finNisabValue();
  if (nisab > 0 && total < nisab) return 0;
  return finRound2(total * 0.025);
}
// Financial-health score 0..100 (emergency 30 · debt 25 · savings 25 · goals 20).
function finHealthScore() {
  let score = 0;
  const targetMonths = Number(state.finSettings?.targetMonths) || 3;
  const cov = finEmergencyCoverage();
  score += Math.max(0, Math.min(1, cov / targetMonths)) * 30;
  const income = finIncome();
  const dti = income > 0 ? finDebtsMonthlyMin() / income : (finDebtsRemaining() > 0 ? 1 : 0);
  score += Math.max(0, Math.min(1, 1 - dti / 0.4)) * 25;
  const p = finPercents();
  const savingsRate = ((Number(p.emergency) || 0) + (Number(p.invest) || 0)) / 100;
  score += Math.max(0, Math.min(1, savingsRate / 0.2)) * 25;
  const goals = state.goals || [];
  if (goals.length) {
    const onTrack = goals.filter(g => {
      const need = finGoalMonthlyNeed(g);
      return need === null || need <= finPlanAmount('invest') + 1;
    }).length;
    score += (onTrack / goals.length) * 20;
  } else {
    score += 20;
  }
  return Math.round(score);
}
function finHealthLabel(s) {
  if (s >= 80) return { txt: 'ممتازة', color: '#3DB981' };
  if (s >= 60) return { txt: 'جيدة', color: '#3574F0' };
  if (s >= 40) return { txt: 'متوسطة', color: '#F0A835' };
  return { txt: 'تحتاج انتباه', color: '#E05C5C' };
}

// ════════════════════════════════════════════════════════════════
//  SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════
function subscribeFinance() {
  (state.finUnsub || []).forEach(u => { try { u(); } catch (e) {} });
  state.finUnsub = [];
  const push = (u) => state.finUnsub.push(u);
  const onErr = (label) => (e) => console.error('finance snapshot:', label, e);
  const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

  push(onSnapshot(accountsRef(), s => { state.accounts = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySort); setOnline(); debounceRender(renderFinHub); }, onErr('accounts')));
  push(onSnapshot(categoriesRef(), s => { state.categories = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySort); debounceRender(renderFinHub); }, onErr('categories')));
  push(onSnapshot(goalsRef(), s => { state.goals = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)); debounceRender(renderFinHub); }, onErr('goals')));
  push(onSnapshot(debtsRef(), s => { state.debts = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySort); debounceRender(renderFinHub); }, onErr('debts')));
  push(onSnapshot(assetsRef(), s => { state.assets = s.docs.map(d => ({ id: d.id, ...d.data() })); debounceRender(renderFinHub); }, onErr('assets')));
  push(onSnapshot(goldAssetsRef(), s => { state.goldAssets = s.docs.map(d => ({ id: d.id, ...d.data() })); debounceRender(renderFinHub); }, onErr('gold')));
  push(onSnapshot(transactionsRef(), s => { state.transactions = s.docs.map(d => ({ id: d.id, ...d.data() })); debounceRender(renderFinHub); }, onErr('transactions')));
  push(onSnapshot(planDoc(), d => { state.plan = d.exists() ? d.data() : null; debounceRender(renderFinHub); }, onErr('plan')));
  push(onSnapshot(goldPricesDoc(), d => { state.goldPrices = d.exists() ? d.data() : null; debounceRender(renderFinHub); }, onErr('goldPrices')));
  push(onSnapshot(finSettingsDoc(), d => { state.finSettings = { targetMonths: 3, nisabGrams: 85, usdEgp: 50, zakatDueDate: null, ...(d.exists() ? d.data() : {}) }; debounceRender(renderFinHub); }, onErr('finSettings')));

  renderFinHub();
}

// ════════════════════════════════════════════════════════════════
//  RENDER — router + shared builders
// ════════════════════════════════════════════════════════════════
function renderFinHub() {
  updateDashFinancePortal();
  const v = state.view;
  if      (v === 'finance')         renderFinanceHome();
  else if (v === 'finance-budget')  renderFinanceBudget();
  else if (v === 'finance-debts')   renderFinanceDebts();
  else if (v === 'finance-goals')   renderFinanceGoals();
  else if (v === 'finance-assets')  renderFinanceAssets();
  else if (v === 'finance-emergency') renderFinanceEmergency();
  else if (v === 'finance-zakat')   renderFinanceZakat();
}
function updateDashFinancePortal() {
  const sub = document.getElementById('dash-finance-subtitle');
  if (sub) sub.textContent = `صافي الثروة: ${finFmt(finNetWorth())} ${FIN_CUR}`;
}

function finToolbar(title, actionsHtml, backView) {
  const back = backView
    ? `<button class="fin-back" data-fin-nav="${backView}" type="button" title="رجوع">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
       </button>`
    : '';
  return `<div class="fin-toolbar">${back}<span class="fin-title">${title}</span><div class="fin-spacer"></div>${actionsHtml || ''}</div>`;
}
function finBar(pct, color) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="fin-bar"><div class="fin-bar-fill" style="width:${p}%;background:${color || 'var(--accent)'}"></div></div>`;
}
// Main content + a narrow side card for the page's one headline stat — same
// grammar as the finance-home layout (net-worth card in the side rail).
function finSideLayout(mainHtml, sideHtml) {
  if (!sideHtml) return mainHtml;
  return `<div class="fin-layout"><div class="fin-main">${mainHtml}</div><aside class="fin-side">${sideHtml}</aside></div>`;
}
function finEmpty(icon, msg, actHtml) {
  return `<div class="fin-empty"><div class="fin-empty-icon">${icon}</div><p>${msg}</p>${actHtml || ''}</div>`;
}
function finBtn(act, label, cls) {
  return `<button class="fin-btn ${cls || ''}" data-fin-act="${act}" type="button">${label}</button>`;
}

// ── Health ring (SVG donut) ──
function finHealthRing(score) {
  const { txt, color } = finHealthLabel(score);
  const r = 44, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  return `<div class="fin-health-wrap">
    <span class="fin-health-title">الصحة المالية <span class="fin-health-hint" title="مقياس من 100 يجمع بين تغطية الطوارئ، نسبة الديون، نسبة الادخار، ومدى تقدّمك في أهدافك">؟</span></span>
    <div class="fin-health">
      <svg viewBox="0 0 110 110" class="fin-health-svg">
        <circle cx="55" cy="55" r="${r}" class="fin-health-track"/>
        <circle cx="55" cy="55" r="${r}" class="fin-health-arc" stroke="${color}"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
      </svg>
      <div class="fin-health-center"><strong>${score}<small>/100</small></strong><span>${txt}</span></div>
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
//  RENDER — HOME (the report / dashboard)
// ════════════════════════════════════════════════════════════════
function renderFinanceHome() {
  const root = document.getElementById('fin-home-root');
  if (!root) return;

  const net = finNetWorth();
  const score = finHealthScore();
  const period = state.finPeriod || finThisPeriod();

  const actions = finBtn('income', '＋ دخل', 'fin-btn-success')
                + finBtn('expense', '－ مصروف', 'fin-btn-danger')
                + finBtn('plan', '⚙️ الخطة', 'fin-btn-ghost')
                + `<button class="fin-btn fin-btn-ghost fin-btn-icon" data-fin-act="privacy" type="button" title="إظهار/إخفاء">👁️</button>`;

  // Net worth card — side panel, like the hub's prayer-times card
  const netCard = `<div class="fin-section fin-net-card">
    <div class="fin-hero-net">
      <span class="fin-hero-label">صافي الثروة</span>
      <span class="fin-hero-value ${net < 0 ? 'is-neg' : ''}">${finPriv(finFmt(net))} <em>${FIN_CUR}</em></span>
    </div>
    ${finHealthRing(score)}
    <div class="fin-hero-breakdown">
      <span>💧 سيولة ${finPriv(finFmt(finAccountsTotal()))}</span>
      <span>🥇 ذهب ${finPriv(finFmt(finGoldValue()))}</span>
      <span>📈 استثمار ${finPriv(finFmt(finAssetsValue()))}</span>
      <span class="is-neg">💳 ديون ${finPriv(finFmt(finDebtsRemaining()))}</span>
    </div>
  </div>`;

  // Plan breakdown bar — sits under the net-worth card in the side column
  const plan = renderPlanBreakdown();

  // Status cards — 3-column grid, drag-reorderable (order saved per-user)
  const cards = `<div class="fin-cards fin-cards-grid">${finHomeCardsHtml(period)}</div>`;

  root.innerHTML = finToolbar('', actions, 'dashboard') +
    `<div class="fin-page">
      <div class="fin-layout">
        <div class="fin-main">${cards}</div>
        <aside class="fin-side">${netCard}${plan}</aside>
      </div>
    </div>`;
}

function renderPlanBreakdown() {
  const income = finIncome();
  const p = finPercents();
  const sum = finPercentsSum();
  const segs = FIN_BUCKETS.map(b => {
    const pct = Number(p[b.key]) || 0;
    return `<div class="fin-plan-seg" style="flex:${pct};background:${b.color}" title="${b.label} ${pct}%"></div>`;
  }).join('');
  const legend = FIN_BUCKETS.map(b => {
    const pct = Number(p[b.key]) || 0;
    const amt = finRound2(income * pct / 100);
    return `<div class="fin-plan-leg">
      <span class="fin-dot" style="background:${b.color}"></span>
      <span class="fin-plan-leg-name">${b.icon} ${b.label}</span>
      <span class="fin-plan-leg-amt">${income > 0 ? finPriv(finFmt(amt)) + ' ' + FIN_CUR : ''}</span>
      <span class="fin-plan-leg-pct">${pct}%</span>
    </div>`;
  }).join('');
  const warn = sum !== 100 ? `<span class="fin-plan-warn">⚠️ مجموع النِّسب ${sum}% (المفروض 100%)</span>` : '';
  const head = income > 0
    ? `الدخل الشهري <strong>${finPriv(finFmt(income))} ${FIN_CUR}</strong> ${warn}`
    : `<button class="fin-link" data-fin-act="plan" type="button">➕ حدّد دخلك الشهري ونِسبك</button> ${warn}`;
  return `<div class="fin-section fin-plan-box">
    <div class="fin-section-head"><h3>🧭 خطة توزيع الدخل</h3>
      <button class="fin-link" data-fin-act="plan" type="button">تعديل</button></div>
    <div class="fin-plan-head">${head}</div>
    <div class="fin-plan-bar">${segs}</div>
    <div class="fin-plan-legend">${legend}</div>
  </div>`;
}

function finHomeCard(nav, icon, title, valueHtml, subHtml, barHtml, dragKey) {
  // A native <button> is an unreliable HTML5 drag source in some browsers
  // (mousedown gets eaten by the control's own press state), so — same as
  // the client/project cards — draggable ones render as a div with
  // role="button" instead.
  const dragAttrs = dragKey ? ` draggable="true" data-card-key="${dragKey}"` : '';
  const tag = dragKey ? 'div' : 'button';
  const typeAttr = dragKey ? ' role="button" tabindex="0"' : ' type="button"';
  return `<${tag} class="fin-card${dragKey ? ' fin-sum-card-draggable' : ''}" data-fin-nav="${nav}"${typeAttr}${dragAttrs}>
    <div class="fin-card-top"><span class="fin-card-icon">${icon}</span><span class="fin-card-title">${title}</span>
      <svg class="fin-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
    </div>
    <div class="fin-card-value">${valueHtml}</div>
    ${barHtml || ''}
    <div class="fin-card-sub">${subHtml || ''}</div>
  </${tag}>`;
}
function finHomeDebtCard() {
  const rem = finDebtsRemaining();
  const n = (state.debts || []).length;
  const sub = n ? `${n} ${n === 1 ? 'التزام' : 'التزامات'} • الحد الأدنى ${finFmt(finDebtsMonthlyMin())}/شهر` : 'لا ديون — ممتاز 👏';
  return finHomeCard('finance-debts', '💳', 'الديون والالتزامات',
    finPriv(finFmt(rem)) + ` <em>${FIN_CUR}</em>`, sub, '', 'debts');
}
function finHomeEmergencyCard() {
  const cov = finEmergencyCoverage();
  const target = Number(state.finSettings?.targetMonths) || 3;
  const pct = (cov / target) * 100;
  const color = cov >= target ? '#3DB981' : cov >= 1 ? '#F0A835' : '#E05C5C';
  return finHomeCard('finance-emergency', '🛟', 'صندوق الطوارئ',
    finPriv(finFmt(finEmergencyBalance())) + ` <em>${FIN_CUR}</em>`,
    `تغطية ${cov.toFixed(1)} / ${target} شهور`, finBar(pct, color), 'emergency');
}
function finHomeGoalsCard() {
  const goals = state.goals || [];
  const onTrack = goals.filter(g => { const need = finGoalMonthlyNeed(g); return need === null || need <= finPlanAmount('invest') + 1; }).length;
  const sub = goals.length ? `${onTrack} في المسار من ${goals.length}` : 'مفيش أهداف بعد';
  return finHomeCard('finance-goals', '🎯', 'الأهداف',
    goals.length ? `${goals.length}` : '—', sub, '', 'goals');
}
function finHomeAssetsCard() {
  const gold = finGoldValue();
  const inv = finAssetsValue();
  const totalA = finTotalAssets();
  const goldPct = totalA > 0 ? (gold / totalA) * 100 : 0;
  return finHomeCard('finance-assets', '🥇', 'الأصول والذهب',
    finPriv(finFmt(gold + inv)) + ` <em>${FIN_CUR}</em>`,
    `الذهب ${goldPct.toFixed(0)}% من أصولك` + (goldPct > 10 ? ' ⚠️ فوق 10%' : ''), '', 'assets');
}
function finHomeBudgetCard(period) {
  const target = (state.categories || []).reduce((s, c) => s + (Number(c.target) || 0), 0);
  const spent = (state.categories || []).reduce((s, c) => s + finCategorySpent(c.id, period), 0);
  const pct = target > 0 ? (spent / target) * 100 : 0;
  const color = pct > 100 ? '#E05C5C' : pct > 80 ? '#F0A835' : '#3DB981';
  return finHomeCard('finance-budget', '🗂️', 'الميزانية الشهرية',
    finPriv(finFmt(spent)) + ` / ${finFmt(target)}`,
    target > 0 ? `صُرف ${pct.toFixed(0)}% من ميزانية الشهر` : 'حدّد بنود مصاريفك', target > 0 ? finBar(pct, color) : '', 'budget');
}
function finHomeZakatCard() {
  const due = finZakatDue();
  const hawl = finHawlPassed();
  const sub = hawl ? '🔔 حان موعد الزكاة' : (state.finSettings?.zakatDueDate ? `الحول: ${state.finSettings.zakatDueDate}` : 'حدّد تاريخ حَوَلان الحول');
  return finHomeCard('finance-zakat', '🕌', 'الزكاة',
    finPriv(finFmt(due)) + ` <em>${FIN_CUR}</em>`, sub, '', 'zakat');
}

// ── Drag-reorderable status cards — order saved to finSettings.cardOrder ──
const FIN_HOME_CARD_BUILDERS = {
  debts:     () => finHomeDebtCard(),
  emergency: () => finHomeEmergencyCard(),
  goals:     () => finHomeGoalsCard(),
  assets:    () => finHomeAssetsCard(),
  budget:    (period) => finHomeBudgetCard(period),
  zakat:     () => finHomeZakatCard(),
};
const FIN_HOME_CARD_DEFAULT_ORDER = ['debts', 'emergency', 'goals', 'assets', 'budget', 'zakat'];
function finHomeCardOrder() {
  const saved = state.finSettings?.cardOrder;
  if (Array.isArray(saved) && saved.length) {
    const known = saved.filter(k => FIN_HOME_CARD_BUILDERS[k]);
    const missing = FIN_HOME_CARD_DEFAULT_ORDER.filter(k => !known.includes(k));
    return [...known, ...missing];
  }
  return FIN_HOME_CARD_DEFAULT_ORDER;
}
function finHomeCardsHtml(period) {
  return finHomeCardOrder().map(key => FIN_HOME_CARD_BUILDERS[key](period)).join('');
}
async function finSaveCardOrder(order) {
  state.finSettings = { ...(state.finSettings || {}), cardOrder: order };
  try { await setDoc(finSettingsDoc(), { cardOrder: order }, { merge: true }); }
  catch (e) { console.error('save card order:', e); }
}

// ════════════════════════════════════════════════════════════════
//  RENDER — BUDGET (accounts + monthly categories)
// ════════════════════════════════════════════════════════════════
function renderFinanceBudget() {
  const root = document.getElementById('fin-budget-root');
  if (!root) return;
  const period = state.finPeriod || finThisPeriod();

  const accActions = finBtn('add-account', '＋ حساب', 'fin-btn-ghost') + finBtn('transfer', '↔ تحويل', 'fin-btn-ghost');
  const accRows = (state.accounts || []).length ? (state.accounts).map(a => `
    <div class="fin-row">
      <div class="fin-row-main">
        <span class="fin-row-icon">${escapeHtml(a.icon || '🏦')}</span>
        <div><div class="fin-row-name">${escapeHtml(a.name)} ${a.isEmergency ? '<span class="fin-tag">🛟 طوارئ</span>' : ''}</div>
        <div class="fin-row-meta">${a.type === 'cash' ? 'كاش' : a.type === 'wallet' ? 'محفظة' : 'حساب'}</div></div>
      </div>
      <div class="fin-row-side">
        <span class="fin-row-amt">${finPriv(finFmt(a.balance))} ${FIN_CUR}</span>
        <button class="fin-icon-btn" data-fin-act="edit-account:${a.id}" title="تعديل">✏️</button>
        <button class="fin-icon-btn" data-fin-act="del-account:${a.id}" title="حذف">🗑️</button>
      </div>
    </div>`).join('') : finEmpty('💧', 'مفيش حسابات لسه.', finBtn('add-account', '＋ ضيف حساب', 'fin-btn-primary'));

  const catActions = finBtn('add-category', '＋ بند', 'fin-btn-ghost');
  const catRows = (state.categories || []).length ? (state.categories).map(c => {
    const spent = finCategorySpent(c.id, period), target = Number(c.target) || 0;
    const pct = target > 0 ? (spent / target) * 100 : 0;
    const color = pct > 100 ? '#E05C5C' : pct > 80 ? '#F0A835' : '#3DB981';
    return `<div class="fin-row fin-row-col">
      <div class="fin-row-line">
        <div class="fin-row-main"><span class="fin-row-icon">${escapeHtml(c.icon || '🗂️')}</span>
          <div class="fin-row-name">${escapeHtml(c.name)}</div></div>
        <div class="fin-row-side">
          <span class="fin-row-amt">${finPriv(finFmt(spent))} / ${finFmt(target)}</span>
          <button class="fin-icon-btn" data-fin-act="edit-category:${c.id}" title="تعديل">✏️</button>
          <button class="fin-icon-btn" data-fin-act="del-category:${c.id}" title="حذف">🗑️</button>
        </div>
      </div>
      ${target > 0 ? finBar(pct, color) : ''}
    </div>`;
  }).join('') : finEmpty('🗂️', 'حدّد بنود مصاريفك الشهرية (إيجار، أكل، فواتير...).', finBtn('add-category', '＋ ضيف بند', 'fin-btn-primary'));

  const txRows = finTxRowsHtml(finRecentTx(20));

  root.innerHTML = finToolbar('🗂️ الميزانية الشهرية', '', 'finance') + `<div class="fin-page">
    <div class="fin-budget-grid">
      <div class="fin-section"><div class="fin-section-head"><h3>💧 الحسابات والسيولة</h3><div class="fin-inline-actions">${accActions}</div></div>
        <div class="fin-list">${accRows}</div>
        <div class="fin-section-foot">الإجمالي: <strong>${finPriv(finFmt(finAccountsTotal()))} ${FIN_CUR}</strong></div>
      </div>
      <div class="fin-section"><div class="fin-section-head"><h3>🗂️ بنود المصاريف — ${finPeriodLabel(period)}</h3><div class="fin-inline-actions">${catActions}</div></div>
        <div class="fin-list">${catRows}</div>
      </div>
      <div class="fin-section"><div class="fin-section-head"><h3>🧾 آخر العمليات</h3></div>
        <div class="fin-list">${txRows}</div>
      </div>
    </div>
  </div>`;
}

// ── Transaction history: shared meta + row rendering + edit/delete ──
function finRecentTx(n) {
  const time = (t) => (t.createdAt && t.createdAt.toDate) ? t.createdAt.toDate().getTime() : 0;
  return [...(state.transactions || [])].sort((a, b) => time(b) - time(a)).slice(0, n || 20);
}
const FIN_TX_EDITABLE = new Set(['income', 'expense', 'sadaqah']);
function finTxMeta(t) {
  const acc = (state.accounts || []).find(a => a.id === t.accountId);
  const accName = acc ? escapeHtml(acc.name) : '—';
  switch (t.type) {
    case 'income':
      return { icon: '💰', sign: '+', color: '#3DB981', title: 'دخل' + (t.note ? ' — ' + escapeHtml(t.note) : ''), sub: accName };
    case 'expense': {
      const cat = (state.categories || []).find(c => c.id === t.categoryId);
      return { icon: '🧾', sign: '－', color: 'var(--danger)', title: (cat ? escapeHtml(cat.name) : 'مصروف') + (t.note ? ' — ' + escapeHtml(t.note) : ''), sub: accName };
    }
    case 'sadaqah':
      return { icon: '🤲', sign: '－', color: 'var(--danger)', title: 'صدقة' + (t.note ? ' — ' + escapeHtml(t.note) : ''), sub: accName };
    case 'transfer': {
      const to = (state.accounts || []).find(a => a.id === t.toAccountId);
      return { icon: '↔️', sign: '', color: 'var(--text-secondary)', title: 'تحويل', sub: `${accName} ← ${to ? escapeHtml(to.name) : '—'}` };
    }
    case 'debtPayment': {
      const d = (state.debts || []).find(x => x.id === t.debtId);
      return { icon: '💳', sign: '－', color: 'var(--danger)', title: 'دفعة دين' + (d ? ' — ' + escapeHtml(d.creditor) : ''), sub: accName };
    }
    case 'goalContribution': {
      const g = (state.goals || []).find(x => x.id === t.goalId);
      return { icon: '🎯', sign: '－', color: 'var(--text-secondary)', title: 'ادخار لهدف' + (g ? ' — ' + escapeHtml(g.name) : ''), sub: accName };
    }
    case 'zakat':
      return { icon: '🕌', sign: '－', color: 'var(--danger)', title: 'دفع زكاة', sub: accName };
    default:
      return { icon: '•', sign: '', color: 'var(--text-secondary)', title: t.type || '—', sub: accName };
  }
}
function finTxRowsHtml(list) {
  if (!list.length) return finEmpty('🧾', 'لسه مفيش عمليات مسجّلة.');
  return list.map(t => {
    const m = finTxMeta(t);
    const editBtn = FIN_TX_EDITABLE.has(t.type) ? `<button class="fin-icon-btn" data-fin-act="edit-tx:${t.id}" title="تعديل">✏️</button>` : '';
    return `<div class="fin-row">
      <div class="fin-row-main">
        <span class="fin-row-icon">${m.icon}</span>
        <div><div class="fin-row-name">${m.title}</div>
        <div class="fin-row-meta">${m.sub} • ${formatDate(t.createdAt)}</div></div>
      </div>
      <div class="fin-row-side">
        <span class="fin-row-amt" style="color:${m.color}">${m.sign}${finPriv(finFmt(t.amount))} ${FIN_CUR}</span>
        ${editBtn}
        <button class="fin-icon-btn" data-fin-act="del-tx:${t.id}" title="حذف">🗑️</button>
      </div>
    </div>`;
  }).join('');
}
function openTxEditModal(id) {
  const t = (state.transactions || []).find(x => x.id === id);
  if (!t || !FIN_TX_EDITABLE.has(t.type)) return;
  const isIncome = t.type === 'income';
  const isExpense = t.type === 'expense';
  const title = isIncome ? '✏️ تعديل دخل' : isExpense ? '✏️ تعديل مصروف' : '✏️ تعديل صدقة';
  finModal(title,
    finFieldNum('tx-amount', 'المبلغ', t.amount, 'min="0" required') +
    finFieldAccount('tx-account', isIncome ? 'الحساب المستلِم' : 'من حساب', t.accountId) +
    (isExpense ? `<div class="form-group"><label class="form-label">بند المصروف</label><select id="tx-category" class="form-input">${(state.categories || []).map(c => `<option value="${c.id}" ${c.id === t.categoryId ? 'selected' : ''}>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('') || '<option value="">— بدون بند —</option>'}</select></div>` : '') +
    finFieldText('tx-note', 'ملاحظة (اختياري)', t.note || '', ''),
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('tx-amount').value) || 0;
      const accountId = document.getElementById('tx-account').value;
      const acc = (state.accounts || []).find(a => a.id === accountId);
      if (!(amount > 0) || !acc) { toast('راجع البيانات', 'error'); return; }
      const oldAmount = Number(t.amount) || 0;
      const oldAccountId = t.accountId;
      const outflow = !isIncome;
      if (outflow) {
        const availableOnAcc = oldAccountId === accountId ? (Number(acc.balance) || 0) + oldAmount : (Number(acc.balance) || 0);
        if (amount > availableOnAcc + 0.005) { toast(`🚫 رصيد "${acc.name}" مش كفاية`, 'error'); return; }
      }
      try {
        const batch = writeBatch(db);
        if (outflow) {
          batch.update(accountDoc(oldAccountId), { balance: increment(oldAmount) });
          batch.update(accountDoc(accountId), { balance: increment(-amount) });
        } else {
          batch.update(accountDoc(oldAccountId), { balance: increment(-oldAmount) });
          batch.update(accountDoc(accountId), { balance: increment(amount) });
        }
        const data = { amount, accountId, note: document.getElementById('tx-note').value.trim() };
        if (isExpense) data.categoryId = document.getElementById('tx-category').value || null;
        batch.update(doc(transactionsRef(), id), data);
        await batch.commit();
        toast('تم التعديل', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
async function deleteTx(id) {
  const t = (state.transactions || []).find(x => x.id === id);
  if (!t) return;
  const m = finTxMeta(t);
  if (!await confirmDialog({ title: 'حذف عملية', message: `هتحذف "${m.title}" بمبلغ ${finFmt(t.amount)} ${FIN_CUR} — الأثر على الأرصدة هيتراجع. متأكد؟`, icon: '🗑️' })) return;
  try {
    const batch = writeBatch(db);
    const amt = Number(t.amount) || 0;
    switch (t.type) {
      case 'income':
        batch.update(accountDoc(t.accountId), { balance: increment(-amt) });
        break;
      case 'expense':
      case 'sadaqah':
      case 'zakat':
        batch.update(accountDoc(t.accountId), { balance: increment(amt) });
        break;
      case 'transfer':
        batch.update(accountDoc(t.accountId), { balance: increment(amt) });
        batch.update(accountDoc(t.toAccountId), { balance: increment(-amt) });
        break;
      case 'debtPayment':
        batch.update(accountDoc(t.accountId), { balance: increment(amt) });
        if (t.debtId) batch.update(debtDoc(t.debtId), { remaining: increment(amt) });
        break;
      case 'goalContribution':
        batch.update(accountDoc(t.accountId), { balance: increment(amt) });
        if (t.goalId) batch.update(goalDoc(t.goalId), { savedAmount: increment(-amt) });
        break;
    }
    batch.delete(doc(transactionsRef(), id));
    await batch.commit();
    toast('تم الحذف', 'success');
  } catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
}

// ════════════════════════════════════════════════════════════════
//  RENDER — DEBTS
// ════════════════════════════════════════════════════════════════
function renderFinanceDebts() {
  const root = document.getElementById('fin-debts-root');
  if (!root) return;
  const debts = [...(state.debts || [])].sort((a, b) => (Number(a.remaining) || 0) - (Number(b.remaining) || 0)); // snowball order
  const totalRem = finDebtsRemaining();

  const rows = debts.length ? debts.map((d, i) => {
    const total = Number(d.total) || 0, rem = Number(d.remaining) || 0;
    const paidPct = total > 0 ? ((total - rem) / total) * 100 : 0;
    const min = Number(d.monthlyMin) || 0;
    const months = min > 0 ? Math.ceil(rem / min) : null;
    return `<div class="fin-row fin-row-col">
      <div class="fin-row-line">
        <div class="fin-row-main"><span class="fin-row-icon">${escapeHtml(d.icon || '💳')}</span>
          <div><div class="fin-row-name">${escapeHtml(d.creditor)} ${d.hasPenalty ? '<span class="fin-tag fin-tag-danger">غرامة</span>' : ''} ${i === 0 ? '<span class="fin-tag">🎯 ابدأ بيه</span>' : ''}</div>
          <div class="fin-row-meta">متبقّي ${finFmt(rem)} من ${finFmt(total)}${months ? ` • ~${months} شهر` : ''}</div></div>
        </div>
        <div class="fin-row-side">
          ${finBtn('pay-debt:' + d.id, 'دفعة', 'fin-btn-success fin-btn-xs')}
          <button class="fin-icon-btn" data-fin-act="edit-debt:${d.id}" title="تعديل">✏️</button>
          <button class="fin-icon-btn" data-fin-act="del-debt:${d.id}" title="حذف">🗑️</button>
        </div>
      </div>
      ${finBar(paidPct, '#3DB981')}
    </div>`;
  }).join('') : finEmpty('🎉', 'مفيش ديون! لو عليك التزام ضيفه عشان تتابع سداده.', finBtn('add-debt', '＋ ضيف دين', 'fin-btn-primary'));

  const advice = debts.length
    ? `<div class="fin-note">💡 مرتّبين بالأصغر أولاً (Snowball). ادفع الحد الأدنى للكل، وركّز الفائض على أول واحد. سدّد من دخل الفري لانس — مش من صندوق الطوارئ.</div>`
    : '';

  root.innerHTML = finToolbar('💳 الديون والالتزامات', finBtn('add-debt', '＋ دين', 'fin-btn-ghost'), 'finance') +
    `<div class="fin-page">${finSideLayout(
      `${advice}<div class="fin-list">${rows}</div>`,
      `<div class="fin-section fin-total-hero"><span>إجمالي المتبقّي</span><strong class="is-neg">${finPriv(finFmt(totalRem))} ${FIN_CUR}</strong></div>`
    )}</div>`;
}

// ════════════════════════════════════════════════════════════════
//  RENDER — GOALS
// ════════════════════════════════════════════════════════════════
function renderFinanceGoals() {
  const root = document.getElementById('fin-goals-root');
  if (!root) return;
  const goals = state.goals || [];
  const rows = goals.length ? goals.map(g => {
    const val = finGoalValue(g), target = Number(g.targetAmount) || 0;
    const pct = target > 0 ? (val / target) * 100 : 0;
    const need = finGoalMonthlyNeed(g);
    const onTrack = need === null || need <= finPlanAmount('invest') + 1;
    const isAsset = (g.fundingType || 'cash') === 'asset';
    const liqWarn = isAsset && finMonthsUntil(g.deadline) !== null && finMonthsUntil(g.deadline) <= 24
      ? '<span class="fin-tag fin-tag-danger">⚠️ هدف قريب على أصل متقلّب</span>' : '';
    return `<div class="fin-row fin-row-col">
      <div class="fin-row-line">
        <div class="fin-row-main"><span class="fin-row-icon">${escapeHtml(g.icon || '🎯')}</span>
          <div><div class="fin-row-name">${escapeHtml(g.name)} ${isAsset ? '<span class="fin-tag">📈 أصل</span>' : '<span class="fin-tag">💵 كاش</span>'} ${liqWarn}</div>
          <div class="fin-row-meta">${finFmt(val)} / ${finFmt(target)} ${g.deadline ? '• ' + g.deadline : ''}${need !== null ? ` • مطلوب ${finFmt(need)}/شهر` : ''}</div></div>
        </div>
        <div class="fin-row-side">
          ${!isAsset ? finBtn('contribute:' + g.id, '＋ ادخار', 'fin-btn-success fin-btn-xs') : ''}
          <button class="fin-icon-btn" data-fin-act="edit-goal:${g.id}" title="تعديل">✏️</button>
          <button class="fin-icon-btn" data-fin-act="del-goal:${g.id}" title="حذف">🗑️</button>
        </div>
      </div>
      ${finBar(pct, onTrack ? '#3DB981' : '#F0A835')}
    </div>`;
  }).join('') : finEmpty('🎯', 'حدّد أهدافك (بيت، عربية...). الأهداف القريبة خليها كاش، والبعيدة اربطها بأصل بينمو.', finBtn('add-goal', '＋ ضيف هدف', 'fin-btn-primary'));

  root.innerHTML = finToolbar('🎯 الأهداف', finBtn('add-goal', '＋ هدف', 'fin-btn-ghost'), 'finance') +
    `<div class="fin-page"><div class="fin-list">${rows}</div></div>`;
}

// ════════════════════════════════════════════════════════════════
//  RENDER — ASSETS (gold + investments)
// ════════════════════════════════════════════════════════════════
function renderFinanceAssets() {
  const root = document.getElementById('fin-assets-root');
  if (!root) return;
  const g = finGoldGrams();
  const goldVal = finGoldValue();
  const totalA = finTotalAssets();
  const goldPct = totalA > 0 ? (goldVal / totalA) * 100 : 0;
  const prices = state.goldPrices;
  const priceNote = prices
    ? `أسعار الجرام: 24=${finFmt(prices.p24)} · 21=${finFmt(prices.p21)} · 18=${finFmt(prices.p18)} <span class="fin-row-meta">(${prices.source === 'api' ? 'تلقائي' : 'يدوي'})</span>`
    : 'لسه مفيش أسعار — اجلبها تلقائياً أو اكتبها.';

  const goldRows = Object.keys(g).filter(k => g[k] > 0).map(k => `
    <div class="fin-row"><div class="fin-row-main"><span class="fin-row-icon">🥇</span>
      <div class="fin-row-name">عيار ${k} — ${finFmt(g[k])} جم</div></div>
      <div class="fin-row-side"><span class="fin-row-amt">${finPriv(finFmt(g[k] * finPricePerGram(Number(k))))} ${FIN_CUR}</span></div>
    </div>`).join('') || `<div class="fin-row-meta" style="padding:8px 4px">مفيش ذهب مسجّل.</div>`;

  const invRows = (state.assets || []).length ? state.assets.map(a => `
    <div class="fin-row"><div class="fin-row-main"><span class="fin-row-icon">${a.type === 'realestate' ? '🏘️' : '📈'}</span>
      <div><div class="fin-row-name">${escapeHtml(a.name)}</div><div class="fin-row-meta">${finAssetTypeLabel(a.type)}${a.platform ? ' • ' + escapeHtml(a.platform) : ''}</div></div></div>
      <div class="fin-row-side"><span class="fin-row-amt">${finPriv(finFmt(a.currentValue))} ${FIN_CUR}</span>
        <button class="fin-icon-btn" data-fin-act="edit-asset:${a.id}" title="تعديل">✏️</button>
        <button class="fin-icon-btn" data-fin-act="del-asset:${a.id}" title="حذف">🗑️</button></div>
    </div>`).join('') : finEmpty('📈', 'ضيف استثماراتك الحلال (ذهب ثاندر، صندوق إسلامي، عقار...).', finBtn('add-asset', '＋ استثمار', 'fin-btn-primary'));

  const advice = goldPct > 10 ? `<div class="fin-note fin-note-warn">⚠️ الذهب ${goldPct.toFixed(0)}% من أصولك (المفضّل 5–10%). فكّر في تنويع.</div>` : '';

  root.innerHTML = finToolbar('🥇 الأصول والذهب',
    finBtn('gold-add', '＋ ذهب', 'fin-btn-ghost') + finBtn('gold-prices', '🔄 الأسعار', 'fin-btn-ghost') + finBtn('add-asset', '＋ استثمار', 'fin-btn-ghost'),
    'finance') + `<div class="fin-page">${finSideLayout(
      `${advice}
      <div class="fin-section"><div class="fin-section-head"><h3>🥇 الذهب</h3>
        <div class="fin-inline-actions">${finBtn('gold-add', '＋ إضافة', 'fin-btn-xs fin-btn-ghost')}${finBtn('gold-sub', '－ سحب', 'fin-btn-xs fin-btn-ghost')}</div></div>
        <div class="fin-note">${priceNote}</div>
        <div class="fin-list">${goldRows}</div>
        <div class="fin-section-foot">قيمة الذهب: <strong>${finPriv(finFmt(goldVal))} ${FIN_CUR}</strong></div>
      </div>
      <div class="fin-section"><div class="fin-section-head"><h3>📈 استثمارات حلال</h3><div class="fin-inline-actions">${finBtn('add-asset', '＋ استثمار', 'fin-btn-xs fin-btn-ghost')}</div></div>
        <div class="fin-list">${invRows}</div>
      </div>
      <div class="fin-note">💡 اشترِ الذهب بالتدريج، احتفظ به سنة على الأقل، وبِع عند القمم أو لتحقيق هدف. سبائك 24 مغلّفة = مصنعية أقل.</div>`,
      `<div class="fin-section fin-total-hero"><span>إجمالي الأصول</span><strong>${finPriv(finFmt(totalA))} ${FIN_CUR}</strong></div>`
    )}</div>`;
}
function finAssetTypeLabel(t) {
  return ({ gold: 'ذهب', thndr_gold: 'ذهب (ثاندر)', thndr_fund: 'صندوق إسلامي (ثاندر)', realestate: 'عقار', other: 'أخرى' })[t] || 'استثمار';
}

// ════════════════════════════════════════════════════════════════
//  RENDER — ZAKAT
// ════════════════════════════════════════════════════════════════
function renderFinanceZakat() {
  const root = document.getElementById('fin-zakat-root');
  if (!root) return;
  const total = finZakatableTotal();
  const nisab = finNisavGuard();
  const due = finZakatDue();
  const hawl = finHawlPassed();
  const above = nisab > 0 && total >= nisab;
  const income = finIncome();

  root.innerHTML = finToolbar('🕌 الزكاة والصدقة', finBtn('zakat-settings', '⚙️ إعدادات', 'fin-btn-ghost'), 'finance') +
    `<div class="fin-page">${finSideLayout(
      `<div class="fin-section">
        <div class="fin-kv"><span>الأموال الخاضعة للزكاة</span><strong>${finPriv(finFmt(total))} ${FIN_CUR}</strong></div>
        <div class="fin-kv"><span>النِّصاب (${state.finSettings?.nisabGrams || 85}جم ذهب)</span><strong>${finFmt(nisab)} ${FIN_CUR}</strong></div>
        <div class="fin-kv"><span>فوق النِّصاب؟</span><strong>${above ? 'نعم ✅' : 'لا'}</strong></div>
        <div class="fin-kv"><span>تاريخ حَوَلان الحَوْل</span><strong>${state.finSettings?.zakatDueDate || '— غير محدد'}</strong></div>
        <div class="fin-kv"><span>الحالة</span><strong>${hawl ? '🔔 حان الموعد' : 'لسه'}</strong></div>
      </div>
      ${above && hawl ? `<div class="fin-page-actions">${finBtn('pay-zakat', '💸 سجّل إخراج الزكاة', 'fin-btn-primary')}</div>` : ''}
      <div class="fin-note">💡 الزكاة 2.5% على (الذهب + النقد + الاستثمارات السائلة) بعد مرور عام هجري كامل فوق النِّصاب. العقار للسكن الشخصي لا زكاة عليه.</div>

      <div class="fin-section"><div class="fin-section-head"><h3>🤲 الصدقة</h3>
        <button class="fin-link" data-fin-act="sadaqah" type="button">＋ سجّل صدقة</button></div>
        <div class="fin-kv"><span>صدقة الشهر الحالي</span><strong>${finPriv(finFmt(finSadaqahGiven(finThisPeriod())))} ${FIN_CUR}</strong></div>
        <div class="fin-kv"><span>المقترح شهرياً (من خطتك)</span><strong>${income > 0 ? finFmt(finPlanAmount('sadaqah')) + ' ' + FIN_CUR : '—'}</strong></div>
        <div class="fin-kv"><span>إجمالي صدقاتك</span><strong>${finPriv(finFmt(finSadaqahGiven(null)))} ${FIN_CUR}</strong></div>
      </div>
      <div class="fin-section"><div class="fin-section-head"><h3>🧾 سجل الصدقات</h3></div>
        <div class="fin-list">${finTxRowsHtml((state.transactions || []).filter(t => t.type === 'sadaqah').sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0)))}</div>
      </div>
      <div class="fin-note">🤲 الصدقة تطوّع مستمر (غير الزكاة الواجبة). خطتك بتخصّص نسبة للصدقة والزكاة — سجّل صدقاتك هنا عشان تتابعها.</div>`,
      `<div class="fin-section fin-total-hero"><span>الزكاة المستحقّة (2.5%)</span><strong>${finPriv(finFmt(due))} ${FIN_CUR}</strong></div>`
    )}</div>`;
}
function finNisavGuard() { return finNisabValue(); }
function finSadaqahGiven(period) {
  return (state.transactions || [])
    .filter(t => t.type === 'sadaqah' && (!period || finTxPeriod(t) === period))
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

// ════════════════════════════════════════════════════════════════
//  RENDER — EMERGENCY FUND (its own page)
// ════════════════════════════════════════════════════════════════
function renderFinanceEmergency() {
  const root = document.getElementById('fin-emergency-root');
  if (!root) return;
  const acc = finEmergencyAccount();
  const bal = finEmergencyBalance();
  const ess = finMonthlyEssential();
  const target = Number(state.finSettings?.targetMonths) || 3;
  const cov = finEmergencyCoverage();
  const targetAmt = finEmergencyTarget();
  const pct = targetAmt > 0 ? (bal / targetAmt) * 100 : 0;
  const color = cov >= target ? '#3DB981' : cov >= 1 ? '#F0A835' : '#E05C5C';

  const body = acc ? finSideLayout(
    `<div class="fin-section">
      <div class="fin-kv"><span>التغطية</span><strong>${cov.toFixed(1)} / ${target} شهور</strong></div>
      ${finBar(pct, color)}
      <div class="fin-kv"><span>الهدف (${target} شهور معيشة)</span><strong>${finFmt(targetAmt)} ${FIN_CUR}</strong></div>
      <div class="fin-kv"><span>مصروف المعيشة الشهري</span><strong>${finFmt(ess)} ${FIN_CUR}</strong></div>
      <div class="fin-kv"><span>الحساب المخصّص</span><strong>${escapeHtml(acc.icon || '🛟')} ${escapeHtml(acc.name)}</strong></div>
    </div>
    <div class="fin-page-actions">${finBtn('emergency-deposit', '＋ إيداع في الطوارئ', 'fin-btn-success')}${finBtn('emergency-target', '🎯 تعديل الهدف', 'fin-btn-ghost')}</div>`,
    `<div class="fin-section fin-total-hero"><span>رصيد الطوارئ</span><strong>${finPriv(finFmt(bal))} ${FIN_CUR}</strong></div>`
  ) : (state.accounts || []).length
      ? finEmpty('🛟', 'لسه محدّدتش حساب لصندوق الطوارئ. اختار واحد من حساباتك الموجودة وهيبقى هو صندوق الطوارئ.',
          finBtn('emergency-pick', '🛟 اختار حساب موجود', 'fin-btn-primary') + finBtn('emergency-target', '🎯 حدّد الهدف', 'fin-btn-ghost'))
      : finEmpty('🛟', 'لسه مفيش حسابات. اعمل حساب الأول وعلّم عليه علامة «صندوق الطوارئ».',
          finBtn('add-account', '＋ اعمل حساب', 'fin-btn-primary') + finBtn('emergency-target', '🎯 حدّد الهدف', 'fin-btn-ghost'));

  root.innerHTML = finToolbar('🛟 صندوق الطوارئ', '', 'finance') + `<div class="fin-page">${body}
    <div class="fin-note">💡 صندوق الطوارئ = كاش سائل مقفول لحالات الطوارئ (مرض / فقدان دخل). الهدف 3–6 شهور معيشة. متصرفش منه على المصاريف العادية.</div>
  </div>`;
}
function openEmergencyDepositModal() {
  const acc = finEmergencyAccount();
  if (!acc) { toast('اعمل حساب طوارئ الأول', 'error'); return openAccountModal(null); }
  const sources = (state.accounts || []).filter(a => a.id !== acc.id);
  if (!sources.length) { toast('محتاج حساب تاني تحوّل منه', 'error'); return; }
  const opts = sources.map(a => `<option value="${a.id}">${escapeHtml(a.icon || '')} ${escapeHtml(a.name)} (${finFmt(a.balance)})</option>`).join('');
  finModal('＋ إيداع في صندوق الطوارئ',
    finFieldNum('em-amount', 'المبلغ', '', 'min="0" required') +
    `<div class="form-group"><label class="form-label">من حساب</label><select id="em-from" class="form-input">${opts}</select></div>`,
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('em-amount').value) || 0;
      const from = document.getElementById('em-from').value;
      const accFrom = (state.accounts || []).find(a => a.id === from);
      if (!(amount > 0) || !accFrom) { toast('راجع البيانات', 'error'); return; }
      if (amount > (Number(accFrom.balance) || 0) + 0.005) { toast('الرصيد مش كفاية', 'error'); return; }
      try {
        const batch = writeBatch(db);
        batch.update(accountDoc(from), { balance: increment(-amount) });
        batch.update(accountDoc(acc.id), { balance: increment(amount) });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'transfer', amount, accountId: from, toAccountId: acc.id, period: finThisPeriod(), createdAt: serverTimestamp() });
        await batch.commit();
        toast('تم الإيداع في الطوارئ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openEmergencyPickModal() {
  const accounts = state.accounts || [];
  if (!accounts.length) { toast('اعمل حساب الأول', 'error'); return openAccountModal(null); }
  finModal('🛟 تعيين حساب الطوارئ',
    `<div class="form-group"><label class="form-label">اختَر حساب من حساباتك الموجودة</label>
      <select id="em-pick-account" class="form-input">${finAccountOptions()}</select></div>
     <div class="fin-note">هيتحدد كصندوق الطوارئ ورصيده الحالي هيبقى هو رصيد الصندوق — من غير ما تفتح حساب جديد.</div>`,
    null,
    async (e) => {
      e.preventDefault();
      const id = document.getElementById('em-pick-account').value;
      const acc = accounts.find(a => a.id === id);
      if (!acc) { toast('اختَر حساب', 'error'); return; }
      try {
        const batch = writeBatch(db);
        const other = accounts.find(x => x.isEmergency && x.id !== id);
        if (other) batch.update(accountDoc(other.id), { isEmergency: false });
        batch.update(accountDoc(id), { isEmergency: true });
        await batch.commit();
        toast('تم تحديد حساب الطوارئ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openEmergencyTargetModal() {
  finModal('🎯 هدف صندوق الطوارئ',
    finFieldNum('em-months', 'عدد شهور المعيشة المستهدفة', Number(state.finSettings?.targetMonths) || 3, 'min="1" max="12"') +
    `<div class="fin-note">المُوصى به 3–6 شهور من مصاريف معيشتك.</div>`,
    null,
    async (e) => {
      e.preventDefault();
      const m = Math.max(1, Number(document.getElementById('em-months').value) || 3);
      try { await setDoc(finSettingsDoc(), { targetMonths: m }, { merge: true }); toast('تم الحفظ', 'success'); finCloseModal(); }
      catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openSadaqahModal() {
  if (finNeedAccount()) return;
  finModal('🤲 تسجيل صدقة',
    finFieldNum('sd-amount', 'المبلغ', '', 'min="0" required') +
    finFieldAccount('sd-account', 'من حساب') +
    finFieldText('sd-note', 'ملاحظة (اختياري)', '', 'لمين / على إيه'),
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('sd-amount').value) || 0;
      const accountId = document.getElementById('sd-account').value;
      const acc = (state.accounts || []).find(a => a.id === accountId);
      if (!(amount > 0) || !acc) { toast('راجع البيانات', 'error'); return; }
      if (amount > (Number(acc.balance) || 0) + 0.005) { toast('الرصيد مش كفاية', 'error'); return; }
      try {
        const batch = writeBatch(db);
        batch.update(accountDoc(accountId), { balance: increment(-amount) });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'sadaqah', amount, accountId, note: document.getElementById('sd-note').value.trim(), period: finThisPeriod(), createdAt: serverTimestamp() });
        await batch.commit();
        toast('جزاك الله خيراً 🤲', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}

// ════════════════════════════════════════════════════════════════
//  DYNAMIC MODAL
// ════════════════════════════════════════════════════════════════
let finModalSubmit = null;
function finModal(title, bodyHtml, footerHtml, onSubmit) {
  document.getElementById('fin-modal-title').innerHTML = title;
  document.getElementById('fin-modal-body').innerHTML = bodyHtml;
  document.getElementById('fin-modal-footer').innerHTML = footerHtml ||
    `<button type="button" class="btn-ghost" data-fin-modal-close>إلغاء</button><button type="submit" class="btn-primary">حفظ</button>`;
  finModalSubmit = onSubmit;
  finShow('fin-modal-overlay');
  setTimeout(() => document.querySelector('#fin-modal-body input,#fin-modal-body select')?.focus(), 60);
}
function finCloseModal() { finHide('fin-modal-overlay'); finModalSubmit = null; }

// Shared field builders
function finFieldNum(id, label, val, extra) {
  return `<div class="form-group"><label class="form-label">${label}</label>
    <input type="number" id="${id}" class="form-input" step="0.01" inputmode="decimal" value="${val ?? ''}" ${extra || ''}/></div>`;
}
function finFieldText(id, label, val, ph, extra) {
  return `<div class="form-group"><label class="form-label">${label}</label>
    <input type="text" id="${id}" class="form-input" value="${val != null ? escapeHtml(String(val)) : ''}" placeholder="${ph || ''}" ${extra || ''}/></div>`;
}
function finAccountOptions(selId) {
  return (state.accounts || []).map(a => `<option value="${a.id}" ${a.id === selId ? 'selected' : ''}>${escapeHtml(a.icon || '')} ${escapeHtml(a.name)} (${finFmt(a.balance)})</option>`).join('');
}
function finFieldAccount(id, label, selId) {
  return `<div class="form-group"><label class="form-label">${label}</label>
    <select id="${id}" class="form-input" required>${finAccountOptions(selId)}</select></div>`;
}
function finNeedAccount() {
  if ((state.accounts || []).length) return false;
  toast('محتاج حساب/محفظة الأول — بيتفتحلك دلوقتي', 'info');
  openAccountModal(null);
  return true;
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — plan
// ════════════════════════════════════════════════════════════════
function openPlanModal() {
  const p = finPercents();
  const income = finIncome();
  const sliders = FIN_BUCKETS.map(b => `
    <div class="fin-slider-row">
      <label>${b.icon} ${b.label}</label>
      <div class="fin-slider-ctl">
        <input type="range" min="0" max="100" step="1" value="${Number(p[b.key]) || 0}" data-plan-key="${b.key}" class="fin-slider" style="accent-color:${b.color}">
        <input type="number" min="0" max="100" value="${Number(p[b.key]) || 0}" data-plan-num="${b.key}" class="form-input fin-slider-num">
      </div>
    </div>`).join('');
  finModal('🧭 خطة توزيع الدخل',
    finFieldNum('plan-income', 'الدخل الشهري (جنيه)', income, 'min="0"') +
    `<div class="fin-sliders">${sliders}</div>
     <div class="fin-alloc-summary"><span>مجموع النِّسب:</span><strong id="plan-sum">0%</strong></div>`,
    `<button type="button" class="btn-ghost" data-fin-modal-close>إلغاء</button><button type="submit" class="btn-primary">💾 حفظ الخطة</button>`,
    savePlan);
  updatePlanSum();
}
function updatePlanSum() {
  const body = document.getElementById('fin-modal-body');
  if (!body) return;
  let sum = 0;
  body.querySelectorAll('[data-plan-num]').forEach(n => sum += Number(n.value) || 0);
  const el = document.getElementById('plan-sum');
  if (el) { el.textContent = sum + '%'; el.classList.toggle('fin-bad', sum !== 100); }
}
async function savePlan(e) {
  e.preventDefault();
  const income = Number(document.getElementById('plan-income').value) || 0;
  const percents = {};
  let sum = 0;
  document.querySelectorAll('#fin-modal-body [data-plan-num]').forEach(n => {
    const k = n.dataset.planNum; const v = Number(n.value) || 0; percents[k] = v; sum += v;
  });
  if (sum !== 100) { toast(`مجموع النِّسب ${sum}% — لازم يساوي 100%`, 'error'); return; }
  try {
    await setDoc(planDoc(), { income, percents, updatedAt: serverTimestamp() }, { merge: true });
    toast('تم حفظ الخطة', 'success');
    finCloseModal();
  } catch (err) { console.error(err); toast('فشل الحفظ', 'error'); }
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — accounts
// ════════════════════════════════════════════════════════════════
function openAccountModal(id) {
  const a = (state.accounts || []).find(x => x.id === id) || {};
  finModal(id ? '✏️ تعديل حساب' : '＋ حساب جديد',
    finFieldText('acc-icon', 'أيقونة', a.icon || '🏦', '🏦', 'maxlength="2"') +
    finFieldText('acc-name', 'الاسم', a.name, 'مثلاً: كاش / إنستاباي', 'required') +
    `<div class="form-group"><label class="form-label">النوع</label><select id="acc-type" class="form-input">
      <option value="cash" ${a.type === 'cash' ? 'selected' : ''}>كاش</option>
      <option value="wallet" ${a.type === 'wallet' ? 'selected' : ''}>محفظة إلكترونية</option>
      <option value="bank" ${a.type === 'bank' ? 'selected' : ''}>حساب بنكي (بدون فائدة)</option></select></div>` +
    finFieldNum('acc-balance', 'الرصيد الحالي', a.balance || 0, 'min="0"') +
    `<label class="fin-check"><input type="checkbox" id="acc-emergency" ${a.isEmergency ? 'checked' : ''}> 🛟 ده حساب صندوق الطوارئ</label>`,
    null,
    async (e) => {
      e.preventDefault();
      const data = {
        icon: document.getElementById('acc-icon').value.trim() || '🏦',
        name: document.getElementById('acc-name').value.trim(),
        type: document.getElementById('acc-type').value,
        balance: Number(document.getElementById('acc-balance').value) || 0,
        isEmergency: document.getElementById('acc-emergency').checked,
      };
      if (!data.name) { toast('اكتب اسم', 'error'); return; }
      try {
        if (data.isEmergency) {
          const other = (state.accounts || []).find(x => x.isEmergency && x.id !== id);
          if (other) await updateDoc(accountDoc(other.id), { isEmergency: false });
        }
        if (id) await updateDoc(accountDoc(id), data);
        else await addDoc(accountsRef(), { ...data, sortOrder: (state.accounts || []).length, createdAt: serverTimestamp() });
        toast('تم الحفظ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل الحفظ', 'error'); }
    });
}
async function deleteAccount(id) {
  const a = (state.accounts || []).find(x => x.id === id);
  if (!a) return;
  if (!await confirmDialog({ title: 'حذف حساب', message: `هتحذف حساب "${a.name}" — متأكد؟`, icon: '🗑️' })) return;
  try { await deleteDoc(accountDoc(id)); toast('تم الحذف', 'success'); }
  catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — categories
// ════════════════════════════════════════════════════════════════
function openCategoryModal(id) {
  const c = (state.categories || []).find(x => x.id === id) || {};
  finModal(id ? '✏️ تعديل بند' : '＋ بند مصروف',
    finFieldText('cat-icon', 'أيقونة', c.icon || '🗂️', '🗂️', 'maxlength="2"') +
    finFieldText('cat-name', 'اسم البند', c.name, 'مثلاً: إيجار / أكل / فواتير', 'required') +
    finFieldNum('cat-target', 'الميزانية الشهرية', c.target || 0, 'min="0"'),
    null,
    async (e) => {
      e.preventDefault();
      const data = {
        icon: document.getElementById('cat-icon').value.trim() || '🗂️',
        name: document.getElementById('cat-name').value.trim(),
        target: Number(document.getElementById('cat-target').value) || 0,
      };
      if (!data.name) { toast('اكتب اسم', 'error'); return; }
      try {
        if (id) await updateDoc(categoryDoc(id), data);
        else await addDoc(categoriesRef(), { ...data, sortOrder: (state.categories || []).length, createdAt: serverTimestamp() });
        toast('تم الحفظ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل الحفظ', 'error'); }
    });
}
async function deleteCategory(id) {
  const c = (state.categories || []).find(x => x.id === id);
  if (!c) return;
  if (!await confirmDialog({ title: 'حذف بند', message: `هتحذف بند "${c.name}" — متأكد؟`, icon: '🗑️' })) return;
  try { await deleteDoc(categoryDoc(id)); toast('تم الحذف', 'success'); }
  catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — income / expense / transfer
// ════════════════════════════════════════════════════════════════
function openIncomeModal() {
  if (finNeedAccount()) return;
  finModal('＋ إضافة دخل',
    finFieldNum('inc-amount', 'المبلغ', '', 'min="0" required') +
    finFieldAccount('inc-account', 'الحساب المستلِم') +
    `<div class="form-group"><label class="form-label">نوع الدخل</label><select id="inc-kind" class="form-input">
      <option value="salary">💼 مرتب (منتظم)</option><option value="freelance">🧑‍💻 فري لانس (استخدمه للديون/الأهداف)</option></select></div>` +
    finFieldText('inc-note', 'ملاحظة (اختياري)', '', 'مصدر الدخل'),
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('inc-amount').value) || 0;
      const accountId = document.getElementById('inc-account').value;
      if (!(amount > 0) || !accountId) { toast('حط مبلغ وحساب', 'error'); return; }
      try {
        const batch = writeBatch(db);
        batch.update(accountDoc(accountId), { balance: increment(amount) });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'income', amount, accountId, incomeKind: document.getElementById('inc-kind').value,
          note: document.getElementById('inc-note').value.trim(), period: finThisPeriod(), createdAt: serverTimestamp() });
        await batch.commit();
        toast('تم تسجيل الدخل', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openExpenseModal() {
  if (finNeedAccount()) return;
  const cats = (state.categories || []).map(c => `<option value="${c.id}">${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('');
  finModal('－ تسجيل مصروف',
    finFieldNum('exp-amount', 'المبلغ', '', 'min="0" required') +
    finFieldAccount('exp-account', 'من حساب') +
    `<div class="form-group"><label class="form-label">بند المصروف</label><select id="exp-category" class="form-input">${cats || '<option value="">— بدون بند —</option>'}</select></div>` +
    finFieldText('exp-note', 'ملاحظة (اختياري)', '', 'على إيه؟'),
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('exp-amount').value) || 0;
      const accountId = document.getElementById('exp-account').value;
      const acc = (state.accounts || []).find(a => a.id === accountId);
      if (!(amount > 0) || !acc) { toast('حط مبلغ وحساب', 'error'); return; }
      if (amount > (Number(acc.balance) || 0) + 0.005) { toast(`🚫 رصيد "${acc.name}" مش كفاية (${finFmt(acc.balance)})`, 'error'); return; }
      try {
        const batch = writeBatch(db);
        batch.update(accountDoc(accountId), { balance: increment(-amount) });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'expense', amount, accountId, categoryId: document.getElementById('exp-category').value || null,
          note: document.getElementById('exp-note').value.trim(), period: finThisPeriod(), createdAt: serverTimestamp() });
        await batch.commit();
        toast('تم تسجيل المصروف', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openTransferModal() {
  if ((state.accounts || []).length < 2) { toast('محتاج حسابين على الأقل', 'error'); return; }
  finModal('↔ تحويل بين الحسابات',
    finFieldNum('tr-amount', 'المبلغ', '', 'min="0" required') +
    finFieldAccount('tr-from', 'من حساب') +
    `<div class="form-group"><label class="form-label">إلى حساب</label><select id="tr-to" class="form-input">${finAccountOptions()}</select></div>`,
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('tr-amount').value) || 0;
      const from = document.getElementById('tr-from').value, to = document.getElementById('tr-to').value;
      const accFrom = (state.accounts || []).find(a => a.id === from);
      if (!(amount > 0) || from === to) { toast('راجع البيانات', 'error'); return; }
      if (amount > (Number(accFrom?.balance) || 0) + 0.005) { toast('الرصيد مش كفاية', 'error'); return; }
      try {
        const batch = writeBatch(db);
        batch.update(accountDoc(from), { balance: increment(-amount) });
        batch.update(accountDoc(to), { balance: increment(amount) });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'transfer', amount, accountId: from, toAccountId: to, period: finThisPeriod(), createdAt: serverTimestamp() });
        await batch.commit();
        toast('تم التحويل', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — debts
// ════════════════════════════════════════════════════════════════
function openDebtModal(id) {
  const d = (state.debts || []).find(x => x.id === id) || {};
  finModal(id ? '✏️ تعديل دين' : '＋ دين / التزام',
    finFieldText('debt-creditor', 'الدائن / الجهة', d.creditor, 'مثلاً: قسط / سلفة', 'required') +
    finFieldNum('debt-total', 'إجمالي الدين', d.total || 0, 'min="0"') +
    finFieldNum('debt-remaining', 'المتبقّي', d.remaining ?? d.total ?? 0, 'min="0"') +
    finFieldNum('debt-min', 'الحد الأدنى الشهري', d.monthlyMin || 0, 'min="0"') +
    `<label class="fin-check"><input type="checkbox" id="debt-penalty" ${d.hasPenalty ? 'checked' : ''}> ⚠️ عليه فايدة/غرامة تأخير</label>`,
    null,
    async (e) => {
      e.preventDefault();
      const data = {
        creditor: document.getElementById('debt-creditor').value.trim(),
        total: Number(document.getElementById('debt-total').value) || 0,
        remaining: Number(document.getElementById('debt-remaining').value) || 0,
        monthlyMin: Number(document.getElementById('debt-min').value) || 0,
        hasPenalty: document.getElementById('debt-penalty').checked,
      };
      if (!data.creditor) { toast('اكتب اسم الدائن', 'error'); return; }
      try {
        if (id) await updateDoc(debtDoc(id), data);
        else await addDoc(debtsRef(), { ...data, sortOrder: (state.debts || []).length, createdAt: serverTimestamp() });
        toast('تم الحفظ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openPayDebtModal(id) {
  const d = (state.debts || []).find(x => x.id === id);
  if (!d) return;
  if (finNeedAccount()) return;
  const nonEmerg = (state.accounts || []).filter(a => !a.isEmergency);
  const opts = (nonEmerg.length ? nonEmerg : state.accounts).map(a => `<option value="${a.id}">${escapeHtml(a.icon || '')} ${escapeHtml(a.name)} (${finFmt(a.balance)})</option>`).join('');
  finModal(`دفعة على "${escapeHtml(d.creditor)}"`,
    `<div class="fin-note">المتبقّي: ${finFmt(d.remaining)} ${FIN_CUR}</div>` +
    finFieldNum('pay-amount', 'مبلغ الدفعة', Math.min(Number(d.remaining) || 0, Number(d.monthlyMin) || 0) || '', 'min="0" required') +
    `<div class="form-group"><label class="form-label">من حساب</label><select id="pay-account" class="form-input">${opts}</select></div>
     <div class="fin-note">💡 يُفضّل السداد من دخل الفري لانس — مش من صندوق الطوارئ.</div>`,
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('pay-amount').value) || 0;
      const accountId = document.getElementById('pay-account').value;
      const acc = (state.accounts || []).find(a => a.id === accountId);
      if (!(amount > 0) || !acc) { toast('راجع البيانات', 'error'); return; }
      if (amount > (Number(acc.balance) || 0) + 0.005) { toast('الرصيد مش كفاية', 'error'); return; }
      if (acc.isEmergency && !await confirmDialog({ title: 'دفع من الطوارئ', message: 'بتدفع من صندوق الطوارئ — ده مش مُفضّل. تكمّل؟', icon: '🛟', confirmText: 'أكمل الدفع' })) return;
      try {
        const newRem = Math.max(0, (Number(d.remaining) || 0) - amount);
        const batch = writeBatch(db);
        batch.update(accountDoc(accountId), { balance: increment(-amount) });
        batch.update(debtDoc(id), { remaining: newRem });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'debtPayment', amount, accountId, debtId: id, period: finThisPeriod(), createdAt: serverTimestamp() });
        await batch.commit();
        toast(newRem === 0 ? '🎉 اتقفل الدين!' : 'تم تسجيل الدفعة', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
async function deleteDebt(id) {
  const d = (state.debts || []).find(x => x.id === id);
  if (!d) return;
  if (!await confirmDialog({ title: 'حذف دين', message: `هتحذف دين "${d.creditor}" — متأكد؟`, icon: '🗑️' })) return;
  try { await deleteDoc(debtDoc(id)); toast('تم الحذف', 'success'); }
  catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — goals
// ════════════════════════════════════════════════════════════════
function openGoalModal(id) {
  const g = (state.goals || []).find(x => x.id === id) || {};
  const assetOpts = (state.assets || []).map(a => `<option value="${a.id}" ${a.id === g.linkedAssetId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  finModal(id ? '✏️ تعديل هدف' : '＋ هدف جديد',
    finFieldText('goal-icon', 'أيقونة', g.icon || '🎯', '🎯', 'maxlength="2"') +
    finFieldText('goal-name', 'اسم الهدف', g.name, 'مثلاً: بيت / عربية', 'required') +
    finFieldNum('goal-target', 'المبلغ المستهدف', g.targetAmount || 0, 'min="0"') +
    finFieldNum('goal-saved', 'المُدّخر حالياً (للكاش)', g.savedAmount || 0, 'min="0"') +
    `<div class="form-group"><label class="form-label">التاريخ المستهدف</label><input type="date" id="goal-deadline" class="form-input" value="${g.deadline || ''}"></div>
     <div class="form-group"><label class="form-label">التمويل</label><select id="goal-funding" class="form-input">
       <option value="cash" ${(g.fundingType || 'cash') === 'cash' ? 'selected' : ''}>💵 كاش (للأهداف القريبة)</option>
       <option value="asset" ${g.fundingType === 'asset' ? 'selected' : ''}>📈 أصل استثماري (للأهداف البعيدة)</option></select></div>
     <div class="form-group" id="goal-asset-wrap" style="display:${g.fundingType === 'asset' ? 'block' : 'none'}">
       <label class="form-label">الأصل المربوط</label><select id="goal-asset" class="form-input">${assetOpts || '<option value="">— ضيف أصل الأول —</option>'}</select></div>`,
    null,
    async (e) => {
      e.preventDefault();
      const fundingType = document.getElementById('goal-funding').value;
      const data = {
        icon: document.getElementById('goal-icon').value.trim() || '🎯',
        name: document.getElementById('goal-name').value.trim(),
        targetAmount: Number(document.getElementById('goal-target').value) || 0,
        savedAmount: Number(document.getElementById('goal-saved').value) || 0,
        deadline: document.getElementById('goal-deadline').value || null,
        fundingType,
        linkedAssetId: fundingType === 'asset' ? (document.getElementById('goal-asset').value || null) : null,
      };
      if (!data.name) { toast('اكتب اسم الهدف', 'error'); return; }
      try {
        if (id) await updateDoc(goalDoc(id), data);
        else await addDoc(goalsRef(), { ...data, priority: (state.goals || []).length, createdAt: serverTimestamp() });
        toast('تم الحفظ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
  document.getElementById('goal-funding')?.addEventListener('change', (ev) => {
    document.getElementById('goal-asset-wrap').style.display = ev.target.value === 'asset' ? 'block' : 'none';
  });
}
function openContributeModal(id) {
  const g = (state.goals || []).find(x => x.id === id);
  if (!g) return;
  if (finNeedAccount()) return;
  finModal(`＋ ادخار لهدف "${escapeHtml(g.name)}"`,
    `<div class="fin-note">المُدّخر: ${finFmt(g.savedAmount)} / ${finFmt(g.targetAmount)}</div>` +
    finFieldNum('gc-amount', 'المبلغ', '', 'min="0" required') +
    finFieldAccount('gc-account', 'من حساب'),
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('gc-amount').value) || 0;
      const accountId = document.getElementById('gc-account').value;
      const acc = (state.accounts || []).find(a => a.id === accountId);
      if (!(amount > 0) || !acc) { toast('راجع البيانات', 'error'); return; }
      if (amount > (Number(acc.balance) || 0) + 0.005) { toast('الرصيد مش كفاية', 'error'); return; }
      try {
        const batch = writeBatch(db);
        batch.update(accountDoc(accountId), { balance: increment(-amount) });
        batch.update(goalDoc(id), { savedAmount: increment(amount) });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'goalContribution', amount, accountId, goalId: id, period: finThisPeriod(), createdAt: serverTimestamp() });
        await batch.commit();
        toast('تم الادخار', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
async function deleteGoal(id) {
  const g = (state.goals || []).find(x => x.id === id);
  if (!g) return;
  if (!await confirmDialog({ title: 'حذف هدف', message: `هتحذف هدف "${g.name}" — متأكد؟`, icon: '🗑️' })) return;
  try { await deleteDoc(goalDoc(id)); toast('تم الحذف', 'success'); }
  catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — assets (investments)
// ════════════════════════════════════════════════════════════════
function openAssetModal(id) {
  const a = (state.assets || []).find(x => x.id === id) || {};
  finModal(id ? '✏️ تعديل استثمار' : '＋ استثمار حلال',
    finFieldText('asset-name', 'الاسم', a.name, 'مثلاً: ذهب ثاندر', 'required') +
    `<div class="form-group"><label class="form-label">النوع</label><select id="asset-type" class="form-input">
      <option value="thndr_gold" ${a.type === 'thndr_gold' ? 'selected' : ''}>ذهب (ثاندر)</option>
      <option value="thndr_fund" ${a.type === 'thndr_fund' ? 'selected' : ''}>صندوق إسلامي (ثاندر)</option>
      <option value="gold" ${a.type === 'gold' ? 'selected' : ''}>ذهب آخر</option>
      <option value="realestate" ${a.type === 'realestate' ? 'selected' : ''}>عقار</option>
      <option value="other" ${a.type === 'other' ? 'selected' : ''}>أخرى</option></select></div>` +
    finFieldText('asset-platform', 'المنصة (اختياري)', a.platform, 'Thndr') +
    finFieldNum('asset-value', 'القيمة الحالية', a.currentValue || 0, 'min="0"'),
    null,
    async (e) => {
      e.preventDefault();
      const data = {
        name: document.getElementById('asset-name').value.trim(),
        type: document.getElementById('asset-type').value,
        platform: document.getElementById('asset-platform').value.trim() || null,
        currentValue: Number(document.getElementById('asset-value').value) || 0,
        isHalal: true,
      };
      if (!data.name) { toast('اكتب اسم', 'error'); return; }
      try {
        if (id) await updateDoc(assetDoc(id), data);
        else await addDoc(assetsRef(), { ...data, createdAt: serverTimestamp() });
        toast('تم الحفظ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
async function deleteAsset(id) {
  const a = (state.assets || []).find(x => x.id === id);
  if (!a) return;
  if (!await confirmDialog({ title: 'حذف استثمار', message: `هتحذف "${a.name}" — متأكد؟`, icon: '🗑️' })) return;
  try { await deleteDoc(assetDoc(id)); toast('تم الحذف', 'success'); }
  catch (err) { console.error(err); toast('فشل الحذف', 'error'); }
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — gold (grams + prices) — reuses the old API fetch logic
// ════════════════════════════════════════════════════════════════
function openGoldGramsModal(mode) {
  const isAdd = mode !== 'sub';
  finModal(isAdd ? '🥇 إضافة ذهب' : '🥇 سحب ذهب',
    `<div class="form-group"><label class="form-label">العيار</label><select id="gg-karat" class="form-input">
      <option value="24">عيار 24</option><option value="21">عيار 21</option><option value="18">عيار 18</option></select></div>` +
    finFieldNum('gg-grams', 'عدد الجرامات', '', 'min="0" step="0.001" required') +
    (isAdd ? finFieldText('gg-notes', 'ملاحظة (اختياري)', '', 'مثلاً: سبيكة مغلّفة') : ''),
    `<button type="button" class="btn-ghost" data-fin-modal-close>إلغاء</button><button type="submit" class="btn-primary">${isAdd ? 'إضافة' : 'سحب'}</button>`,
    async (e) => {
      e.preventDefault();
      const karat = Number(document.getElementById('gg-karat').value);
      const grams = Number(document.getElementById('gg-grams').value) || 0;
      if (!(grams > 0)) { toast('حط جرامات صحيحة', 'error'); return; }
      try {
        if (isAdd) {
          await addDoc(goldAssetsRef(), { karat, grams_owned: grams, purchase_date: toLocalISODate(new Date()),
            notes: document.getElementById('gg-notes')?.value.trim() || '', createdAt: serverTimestamp() });
          toast('تمت الإضافة', 'success');
        } else {
          const assets = (state.goldAssets || []).filter(a => Number(a.karat) === karat)
            .sort((a, b) => finTsMillis(a.createdAt) - finTsMillis(b.createdAt));
          const total = assets.reduce((s, a) => s + (Number(a.grams_owned) || 0), 0);
          if (grams > total + 0.0005) { toast(`🚫 معندكش غير ${finFmt(total)} جم عيار ${karat}`, 'error'); return; }
          let remaining = grams; const batch = writeBatch(db);
          for (const a of assets) {
            if (remaining <= 0.0005) break;
            const have = Number(a.grams_owned) || 0;
            if (have <= remaining + 0.0005) { batch.delete(goldAssetDoc(a.id)); remaining -= have; }
            else { batch.update(goldAssetDoc(a.id), { grams_owned: finRound2(have - remaining) }); remaining = 0; }
          }
          await batch.commit();
          toast('تم السحب', 'success');
        }
        finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openGoldPricesModal() {
  const p = state.goldPrices || {};
  finModal('🥇 أسعار الجرام',
    `<p class="form-hint">سعر الدولار المستخدم في الجلب التلقائي: <input type="number" id="gp-usd" class="form-input fin-inline-input" value="${Number(localStorage.getItem('fin-usd-egp')) || state.finSettings?.usdEgp || 50}" style="width:90px"> جنيه</p>` +
    finFieldNum('gold-price-24', 'عيار 24 (جنيه/جرام)', p.p24 || '') +
    finFieldNum('gold-price-21', 'عيار 21 (جنيه/جرام)', p.p21 || '') +
    finFieldNum('gold-price-18', 'عيار 18 (جنيه/جرام)', p.p18 || ''),
    `<button type="button" class="btn-ghost" id="fin-gold-refresh-btn">🔄 جلب تلقائي</button><button type="submit" class="btn-primary">💾 حفظ</button>`,
    async (e) => {
      e.preventDefault();
      const p24 = Number(document.getElementById('gold-price-24').value) || 0;
      const p21 = Number(document.getElementById('gold-price-21').value) || 0;
      const p18 = Number(document.getElementById('gold-price-18').value) || 0;
      const usd = Number(document.getElementById('gp-usd').value) || 0;
      if (usd) localStorage.setItem('fin-usd-egp', String(usd));
      if (!(p24 || p21 || p18)) { toast('اكتب سعر واحد على الأقل', 'error'); return; }
      try {
        await setDoc(goldPricesDoc(), { p24, p21, p18, source: 'manual', updatedAt: serverTimestamp() });
        toast('تم حفظ الأسعار', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل الحفظ', 'error'); }
    });
  document.getElementById('fin-gold-refresh-btn')?.addEventListener('click', fetchGoldPricesAuto);
}
async function fetchGoldPricesAuto() {
  const btn = document.getElementById('fin-gold-refresh-btn');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
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
    const usdEgp = Number(document.getElementById('gp-usd')?.value) || Number(localStorage.getItem('fin-usd-egp')) || 50;
    const gram24 = usdPerOz / 31.1034768 * usdEgp;
    document.getElementById('gold-price-24').value = gram24.toFixed(2);
    document.getElementById('gold-price-21').value = (gram24 * 21 / 24).toFixed(2);
    document.getElementById('gold-price-18').value = (gram24 * 18 / 24).toFixed(2);
    toast('تم الجلب — راجع الأسعار واحفظ', 'info');
  } catch (err) {
    console.error('gold fetch', err);
    toast('تعذّر الجلب — اكتب السعر يدوياً', 'error');
  }
  if (btn) { btn.textContent = orig; btn.disabled = false; }
}

// ════════════════════════════════════════════════════════════════
//  ACTIONS — zakat settings + payment
// ════════════════════════════════════════════════════════════════
function openZakatSettingsModal() {
  const s = state.finSettings || {};
  finModal('⚙️ إعدادات الزكاة',
    finFieldNum('zk-nisab', 'النِّصاب (جرامات ذهب)', s.nisabGrams || 85, 'min="0"') +
    `<div class="form-group"><label class="form-label">تاريخ حَوَلان الحَوْل (متى تُخرج الزكاة)</label>
      <input type="date" id="zk-due" class="form-input" value="${s.zakatDueDate || ''}"></div>
     <div class="fin-note">النِّصاب الشرعي للذهب = 85 جرام تقريباً. حدّد تاريخ مرور العام الهجري على مالك.</div>`,
    null,
    async (e) => {
      e.preventDefault();
      try {
        await setDoc(finSettingsDoc(), {
          nisabGrams: Number(document.getElementById('zk-nisab').value) || 85,
          zakatDueDate: document.getElementById('zk-due').value || null,
        }, { merge: true });
        toast('تم الحفظ', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}
function openPayZakatModal() {
  if (finNeedAccount()) return;
  const due = finZakatDue();
  finModal('💸 إخراج الزكاة',
    `<div class="fin-note">الزكاة المستحقّة: ${finFmt(due)} ${FIN_CUR}</div>` +
    finFieldNum('zk-amount', 'المبلغ', due, 'min="0" required') +
    finFieldAccount('zk-account', 'من حساب'),
    null,
    async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('zk-amount').value) || 0;
      const accountId = document.getElementById('zk-account').value;
      const acc = (state.accounts || []).find(a => a.id === accountId);
      if (!(amount > 0) || !acc) { toast('راجع البيانات', 'error'); return; }
      if (amount > (Number(acc.balance) || 0) + 0.005) { toast('الرصيد مش كفاية', 'error'); return; }
      try {
        const batch = writeBatch(db);
        batch.update(accountDoc(accountId), { balance: increment(-amount) });
        const txRef = doc(transactionsRef());
        batch.set(txRef, { type: 'zakat', amount, accountId, period: finThisPeriod(), createdAt: serverTimestamp() });
        // roll the hawl forward by ~1 lunar year (354 days)
        const next = new Date(); next.setDate(next.getDate() + 354);
        batch.set(finSettingsDoc(), { zakatDueDate: toLocalISODate(next) }, { merge: true });
        await batch.commit();
        toast('تقبّل الله 🤲', 'success'); finCloseModal();
      } catch (err) { console.error(err); toast('فشل', 'error'); }
    });
}

// ════════════════════════════════════════════════════════════════
//  EVENT WIRING
// ════════════════════════════════════════════════════════════════
function finHandleAction(act) {
  const [name, arg] = act.split(':');
  switch (name) {
    case 'income': return openIncomeModal();
    case 'expense': return openExpenseModal();
    case 'transfer': return openTransferModal();
    case 'plan': return openPlanModal();
    case 'privacy': return toggleFinPrivacy();
    case 'add-account': return openAccountModal(null);
    case 'edit-account': return openAccountModal(arg);
    case 'del-account': return deleteAccount(arg);
    case 'add-category': return openCategoryModal(null);
    case 'edit-category': return openCategoryModal(arg);
    case 'del-category': return deleteCategory(arg);
    case 'add-debt': return openDebtModal(null);
    case 'edit-debt': return openDebtModal(arg);
    case 'del-debt': return deleteDebt(arg);
    case 'pay-debt': return openPayDebtModal(arg);
    case 'add-goal': return openGoalModal(null);
    case 'edit-goal': return openGoalModal(arg);
    case 'del-goal': return deleteGoal(arg);
    case 'contribute': return openContributeModal(arg);
    case 'add-asset': return openAssetModal(null);
    case 'edit-asset': return openAssetModal(arg);
    case 'del-asset': return deleteAsset(arg);
    case 'gold-add': return openGoldGramsModal('add');
    case 'gold-sub': return openGoldGramsModal('sub');
    case 'gold-prices': return openGoldPricesModal();
    case 'zakat-settings': return openZakatSettingsModal();
    case 'pay-zakat': return openPayZakatModal();
    case 'sadaqah': return openSadaqahModal();
    case 'emergency-deposit': return openEmergencyDepositModal();
    case 'emergency-target': return openEmergencyTargetModal();
    case 'emergency-pick': return openEmergencyPickModal();
    case 'edit-tx': return openTxEditModal(arg);
    case 'del-tx': return deleteTx(arg);
  }
}
function toggleFinPrivacy() {
  document.querySelectorAll('#content').forEach(c => c.classList.toggle('fin-privacy-on'));
}

// A blank <canvas> is ready synchronously (unlike an <img>, which may not have
// decoded yet on first drag), so it reliably suppresses the browser's default
// drag-ghost screenshot every time.
const FIN_DRAG_BLANK_IMG = document.createElement('canvas');
FIN_DRAG_BLANK_IMG.width = 1;
FIN_DRAG_BLANK_IMG.height = 1;

(function bindFinanceUI() {
  const content = document.getElementById('content');
  if (content) {
    content.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-fin-nav]');
      if (nav) { navigateTo(nav.dataset.finNav); return; }
      const act = e.target.closest('[data-fin-act]');
      if (act) { finHandleAction(act.dataset.finAct); return; }
      const per = e.target.closest('[data-fin-period]');
      if (per) {
        state.finPeriod = finShiftPeriod(state.finPeriod || finThisPeriod(), per.dataset.finPeriod === 'next' ? 1 : -1);
        renderFinHub(); return;
      }
    });
    content.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const nav = e.target.closest('.fin-sum-card-draggable[data-fin-nav]');
      if (nav) navigateTo(nav.dataset.finNav);
    });

    // Drag-reorder for the finance-home status cards — same grammar as the
    // client/project card reordering (dragging-card / drag-over-card classes).
    let dragKey = null;
    content.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.fin-sum-card-draggable');
      if (!card) return;
      dragKey = card.dataset.cardKey;
      card.classList.add('dragging-card');
      e.dataTransfer.effectAllowed = 'move';
      // Suppress the browser's default drag-ghost screenshot; the dashed/faded
      // .dragging-card style on the real card is feedback enough.
      e.dataTransfer.setDragImage(FIN_DRAG_BLANK_IMG, 0, 0);
    });
    content.addEventListener('dragend', () => {
      content.querySelectorAll('.fin-sum-card-draggable').forEach(c => c.classList.remove('dragging-card', 'drag-over-card'));
      dragKey = null;
    });
    content.addEventListener('dragover', (e) => {
      const card = e.target.closest('.fin-sum-card-draggable');
      if (!card || !dragKey || card.dataset.cardKey === dragKey) return;
      e.preventDefault();
      card.classList.add('drag-over-card');
    });
    content.addEventListener('dragleave', (e) => {
      const card = e.target.closest('.fin-sum-card-draggable');
      if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over-card');
    });
    content.addEventListener('drop', (e) => {
      const target = e.target.closest('.fin-sum-card-draggable');
      content.querySelectorAll('.fin-sum-card-draggable.drag-over-card').forEach(c => c.classList.remove('drag-over-card'));
      if (!target || !dragKey || target.dataset.cardKey === dragKey) return;
      e.preventDefault();
      const order = reorderIdsForDrop(finHomeCardOrder(), dragKey, target.dataset.cardKey);
      dragKey = null;
      finSaveCardOrder(order);
      renderFinHub();
    });
  }
  // Dynamic modal wiring
  const ov = document.getElementById('fin-modal-overlay');
  document.getElementById('fin-modal-close')?.addEventListener('click', finCloseModal);
  ov?.addEventListener('click', (e) => {
    if (e.target === ov) finCloseModal();
    if (e.target.closest('[data-fin-modal-close]')) finCloseModal();
  });
  document.getElementById('fin-modal-form')?.addEventListener('submit', (e) => {
    if (typeof finModalSubmit === 'function') finModalSubmit(e);
    else e.preventDefault();
  });
  // live sums for plan sliders
  document.getElementById('fin-modal-body')?.addEventListener('input', (e) => {
    if (e.target.dataset.planKey) {
      const num = document.querySelector(`[data-plan-num="${e.target.dataset.planKey}"]`);
      if (num) num.value = e.target.value;
      updatePlanSum();
    } else if (e.target.dataset.planNum) {
      const rng = document.querySelector(`[data-plan-key="${e.target.dataset.planNum}"]`);
      if (rng) rng.value = e.target.value;
      updatePlanSum();
    }
  });
})();
