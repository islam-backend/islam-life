// ================================================================
//  islam.walied v3.0 — app.js
//  Hierarchy: Dashboard → Clients → Projects → Tasks (Kanban)
//  Firebase Firestore subcollections + Drag & Drop + Dashboard
// ================================================================

import { firebaseConfig, allowedEmail, vapidKey } from './firebase-config.js';
import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getMessaging,
  getToken,
  onMessage
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
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
  limit,
  getDocs,
  getDoc,
  setDoc,
  writeBatch,
  increment,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Init ───────────────────────────────────────────────────────
const firebaseApp = initializeApp(firebaseConfig);
const db          = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache(),
  experimentalAutoDetectLongPolling: true,
});
const auth        = getAuth(firebaseApp);
const provider    = new GoogleAuthProvider();
const messaging   = ('serviceWorker' in navigator && 'PushManager' in window)
  ? getMessaging(firebaseApp)
  : null;

// ════════════════════════════════════════════════════════════════
//  BOOT & AUTH
// ════════════════════════════════════════════════════════════════

let isBooted = false;
// Tracks who is logged in: { uid, email, role: 'owner'|'member', name, memberId }
let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  const loginScreen = document.getElementById('login-screen');
  const loadingOverlay = document.getElementById('loading-overlay');

  if (user) {
    if (user.email === allowedEmail && user.emailVerified) {
      // Owner
      currentUser = { uid: user.uid, email: user.email, role: 'owner', name: 'Islam', memberId: null };
      if (loginScreen) loginScreen.classList.add('hidden');
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
      if (!isBooted) {
        setupColumnDnD();
        // Keep team members synced so the task-assignee dropdown is always ready
        subscribeTeamMembersPersistent();
        navigateTo('dashboard');
        isBooted = true;
      }
    } else if (user.emailVerified) {
      // Check if this is a known team member
      try {
        const snap = await getDocs(query(teamMembersRef(), where('email', '==', user.email)));
        if (!snap.empty) {
          const mDoc = snap.docs[0];
          currentUser = { uid: user.uid, email: user.email, role: 'member', name: mDoc.data().name, memberId: mDoc.id };
          if (loginScreen) loginScreen.classList.add('hidden');
          if (loadingOverlay) loadingOverlay.classList.add('hidden');
          if (!isBooted) {
            navigateTo('my-tasks');
            // Register for push notifications in the background
            registerForNotifications(mDoc.id);
            isBooted = true;
          }
        } else {
          await signOut(auth);
          showLoginError('❌ عذراً، هذا الحساب غير مصرح له بالدخول.');
        }
      } catch (err) {
        console.error('member-check error', err);
        await signOut(auth);
        showLoginError('❌ حدث خطأ أثناء التحقق من الصلاحيات. حاول مجدداً.');
      }
    } else {
      await signOut(auth);
      showLoginError(user.email === allowedEmail
        ? '❌ يجب تفعيل البريد الإلكتروني أولاً. راجع رسالة التفعيل في بريدك ثم حاول مجدداً.'
        : '❌ عذراً، هذا الحساب غير مصرح له بالدخول.');
    }
  } else {
    isBooted = false;
    currentUser = null;
    // Cancel the persistent team-members subscription on sign-out
    if (state.teamMembersUnsub) { try { state.teamMembersUnsub(); } catch(e) {} state.teamMembersUnsub = null; }
    // Clear all Firestore listeners on signout
    cleanupListeners();
    // Reset local data
    state.clients = [];
    state.projects = [];
    state.tasks = [];
    state.allProjects = [];
    state.allTasks = [];
    state.teamMembers = [];
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

// ── Team Members Refs ──────────────────────────────────────────
const teamMembersRef  = ()    => collection(db, 'teamMembers');
const teamMemberDoc   = (id)  => doc(db, 'teamMembers', id);

// ── Task Detail Refs (subtasks + comments) ─────────────────────
const subtasksRef = (cId, pId, tId)          => collection(db, 'clients', cId, 'projects', pId, 'tasks', tId, 'subtasks');
const subtaskDoc  = (cId, pId, tId, sId)     => doc(db, 'clients', cId, 'projects', pId, 'tasks', tId, 'subtasks', sId);
const commentsRef = (cId, pId, tId)          => collection(db, 'clients', cId, 'projects', pId, 'tasks', tId, 'comments');
const commentDoc  = (cId, pId, tId, coId)    => doc(db, 'clients', cId, 'projects', pId, 'tasks', tId, 'comments', coId);

// ── Focus Timer Refs ───────────────────────────────────────────
const focusSessionsRef     = ()                => collection(db, 'focusSessions');
const activeFocusSessionDoc = ()               => doc(db, 'meta', 'activeFocusSession');

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
  teamMembersUnsub:  null,
  myTasksUnsub:      null,
  teamMembers:       [],
  taskDetail: {
    task: null, client: null, project: null,
    subtasks: [], comments: [],
    subtasksUnsub: null, commentsUnsub: null,
    fromMember: false,
  },
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
  // Focus timer (Pomodoro v2)
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
    projectId:        null,  // project this session's time is logged against
    clientId:         null,
    recentSessions:   [],    // last few completed sessions, for the visible log
  },
  // Calendar state (v9.2)
  calendarCursor:       null,     // Date pointing at the displayed month
  dayDate:              null,     // Date selected for day-details view
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
  safeUnsub(state.myTasksUnsub);                 state.myTasksUnsub = null;
  safeUnsub(state.taskDetail.subtasksUnsub);     state.taskDetail.subtasksUnsub = null;
  safeUnsub(state.taskDetail.commentsUnsub);     state.taskDetail.commentsUnsub = null;
  // teamMembersUnsub is intentionally NOT cancelled here — it's a persistent
  // subscription started at boot so the assignee dropdown is always populated.
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
  { id: 'clients', title: 'العملاء',    icon: '👥', view: 'clients', ownerOnly: true },
  { id: 'team',    title: 'الفريق',     icon: '🤝', view: 'team',    ownerOnly: true },
  { id: 'focus',   title: 'فوكس تايمر', icon: '⏱', view: 'focus',   ownerOnly: true },
];

function renderHub() {
  const grid = document.getElementById('hub-grid');
  if (!grid) return;
  const isOwner = currentUser?.role === 'owner';
  const visible = MODULES.filter(m => !m.ownerOnly || isOwner);
  grid.innerHTML = visible.map(m => `
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

  } else if (view === 'focus') {
    state.client = null; state.project = null;
    document.getElementById('view-focus').classList.add('active');
    renderFocusPage();
    restoreActiveFocusSessionOnLoad();
    subscribeFocusLog();

  } else if (view === 'task-detail') {
    // Preserve client/project from payload OR from current state (when opened from kanban)
    state.taskDetail.task       = payload.task    || null;
    state.taskDetail.client     = payload.client  || state.client  || null;
    state.taskDetail.project    = payload.project || state.project || null;
    state.taskDetail.fromMember = payload.fromMember || false;
    document.getElementById('view-task-detail').classList.add('active');
    subscribeTaskDetail();

  } else if (view === 'team') {
    state.client = null; state.project = null;
    document.getElementById('view-team').classList.add('active');
    renderTeamView();       // paint immediately with cached data
    subscribeTeamMembers(); // then subscribe for live updates

  } else if (view === 'my-tasks') {
    state.client = null; state.project = null;
    document.getElementById('view-my-tasks').classList.add('active');
    subscribeMyTasks();

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

  if (state.view === 'focus' && !state.focus.active) renderFocusPage();
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
//  FOCUS TIMER — Pomodoro v2 (orb between the tiles and side panel)
// ════════════════════════════════════════════════════════════════

const FOCUS_PRESETS = {
  quick: { label: '⚡ سريع 25/5', workMinutes: 25, breakMinutes: 5 },
  deep:  { label: '🎯 عميق 50/10', workMinutes: 50, breakMinutes: 10 },
};

// r + half the stroke-width must stay inside the 0-100 viewBox or the SVG's
// default clip cuts the outer edge of the stroke off — keep a safe margin.
const FOCUS_RING_R = 42;
const FOCUS_RING_CIRC = 2 * Math.PI * FOCUS_RING_R;

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

// Project the current session is logged against, joined with its client —
// used for the "which project is this time going to" label + gauge lookup.
function focusLinkedProject() {
  if (!state.focus.projectId) return null;
  return state.allProjects.find(p => p.id === state.focus.projectId) || null;
}

function focusStopTick() {
  if (state.focus.tickInterval) { clearInterval(state.focus.tickInterval); state.focus.tickInterval = null; }
}

function focusStartTick() {
  focusStopTick();
  state.focus.tickInterval = setInterval(() => {
    if (state.view !== 'focus') return;
    if (!state.focus.active || state.focus.pausedAt) { focusPaintRunning(); return; }
    const remaining = focusRemainingSec();
    if (remaining <= 0) { focusCompletePhase(); return; }
    focusPaintRunning();
  }, 250);
}

function focusPaintRunning() {
  const countEl = document.getElementById('focus-ring-count');
  const ringEl  = document.getElementById('focus-ring-progress');
  if (!countEl) return;
  const remaining = Math.max(0, focusRemainingSec());
  countEl.textContent = focusFmtClock(remaining);
  if (ringEl && state.focus.phaseDurationSec) {
    const R = 88, CIRC = 2 * Math.PI * R;
    const elapsedFrac = 1 - Math.max(0, Math.min(1, remaining / state.focus.phaseDurationSec));
    ringEl.setAttribute('stroke-dashoffset', (CIRC * elapsedFrac).toFixed(1));
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
    projectId: f.projectId,
    clientId: f.clientId,
  });
}

async function startFocusSession(preset) {
  const cfg = FOCUS_PRESETS[preset];
  if (!cfg) return;
  const projectId = state.focus.projectId || null;
  const project = projectId ? state.allProjects.find(p => p.id === projectId) : null;
  const clientId = project?._ref ? project._ref.parent.parent.id : null;
  Object.assign(state.focus, {
    active: true,
    preset,
    phase: 'work',
    phaseStartedAt: Date.now(),
    phaseDurationSec: cfg.workMinutes * 60,
    pausedAt: null,
    accumulatedPauseSec: 0,
    projectId,
    clientId,
  });
  renderFocusPage();
  focusStartTick();
  try { await focusWriteActiveDoc(); } catch (e) { console.error('focus start:', e); }
}

async function pauseFocusSession() {
  const f = state.focus;
  if (!f.active || f.pausedAt) return;
  f.pausedAt = Date.now();
  renderFocusPage();
  try { await focusWriteActiveDoc(); } catch (e) { console.error('focus pause:', e); }
}

async function resumeFocusSession() {
  const f = state.focus;
  if (!f.active || !f.pausedAt) return;
  f.accumulatedPauseSec += (Date.now() - f.pausedAt) / 1000;
  f.pausedAt = null;
  renderFocusPage();
  try { await focusWriteActiveDoc(); } catch (e) { console.error('focus resume:', e); }
}

async function resetFocusSession() {
  Object.assign(state.focus, {
    active: false, preset: null, phase: null,
    phaseStartedAt: 0, phaseDurationSec: 0,
    pausedAt: null, accumulatedPauseSec: 0,
    projectId: null, clientId: null,
  });
  focusStopTick();
  renderFocusPage();
  try { await setDoc(activeFocusSessionDoc(), { active: false }); } catch (e) { console.error('focus reset:', e); }
}

async function focusCompletePhase() {
  const f = state.focus;
  if (f.phase === 'work') {
    const cfg = FOCUS_PRESETS[f.preset];
    toast('انتهت فترة التركيز! خد استراحة ☕', 'success');
    if (f.projectId && f.clientId) {
      try {
        await updateDoc(projectDoc(f.clientId, f.projectId), { totalProjectHours: increment(cfg.workMinutes / 60) });
      } catch (e) { console.error('focus project hours log:', e); }
    }
    Object.assign(f, {
      phase: 'break',
      phaseStartedAt: Date.now(),
      phaseDurationSec: cfg.breakMinutes * 60,
      pausedAt: null,
      accumulatedPauseSec: 0,
    });
    renderFocusPage();
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
      projectId: f.projectId,
      clientId: f.clientId,
      createdAt: serverTimestamp(),
    });
    await setDoc(activeFocusSessionDoc(), { active: false });
  } catch (e) { console.error('focus complete:', e); }
  Object.assign(f, {
    active: false, preset: null, phase: null,
    phaseStartedAt: 0, phaseDurationSec: 0,
    pausedAt: null, accumulatedPauseSec: 0,
    projectId: null, clientId: null,
  });
  renderFocusPage();
}

// ── Full-page focus timer ──────────────────────────────────────
function renderFocusPage() {
  const page = document.getElementById('view-focus');
  if (!page) return;
  const f = state.focus;

  if (!f.active) {
    const options = state.allProjects
      .map(p => ({ id: p.id, label: p.name || 'مشروع', hours: Number(p.totalProjectHours) || 0 }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
    state.focus.projectOptions = options;
    const activePreset = f.preset || 'quick';

    page.innerHTML = `
      <div class="fp-wrap">
        <button class="td-back-btn fp-back-btn" id="fp-back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6"></polyline></svg>
          الرئيسية
        </button>
        <div class="fp-ring-area">
          <div class="fp-ring-wrap">
            <svg class="fp-ring-svg" viewBox="0 0 200 200">
              <circle class="fp-ring-track" cx="100" cy="100" r="88"></circle>
              <circle class="fp-ring-idle" cx="100" cy="100" r="88" stroke-dasharray="552.9" stroke-dashoffset="0"></circle>
            </svg>
            <div class="fp-ring-inner">
              <div class="fp-ring-time" id="fp-idle-time">${activePreset === 'deep' ? '50:00' : '25:00'}</div>
              <div class="fp-ring-label">جاهز</div>
            </div>
          </div>
        </div>

        <div class="fp-presets">
          <button class="fp-preset-btn ${activePreset === 'quick' ? 'active' : ''}" type="button" data-fp-preset="quick">
            <span class="fp-preset-icon">⚡</span>
            <span class="fp-preset-name">سريع</span>
            <span class="fp-preset-time">25 / 5 د</span>
          </button>
          <button class="fp-preset-btn ${activePreset === 'deep' ? 'active' : ''}" type="button" data-fp-preset="deep">
            <span class="fp-preset-icon">🎯</span>
            <span class="fp-preset-name">عميق</span>
            <span class="fp-preset-time">50 / 10 د</span>
          </button>
        </div>

        <div class="focus-dd fp-dd" id="focus-project-dd">
          <button class="focus-dd-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span class="focus-dd-icon">📁</span>
            <span class="focus-dd-text placeholder" id="focus-dd-text">بدون مشروع</span>
            <svg class="focus-dd-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="focus-dd-menu" id="focus-dd-menu" role="listbox">
            <div class="focus-dd-item selected" data-value="" role="option">بدون مشروع</div>
            ${options.map(o => `<div class="focus-dd-item" data-value="${o.id}" role="option">${escapeHtml(o.label)}</div>`).join('')}
          </div>
        </div>
        <div class="fp-time-note" id="focus-orb-time-note"></div>

        <button class="fp-start-btn" type="button" id="fp-start-btn">ابدأ الجلسة</button>

        <div class="fp-log-wrap">
          <div class="fp-log-heading">آخر الجلسات</div>
          <div class="focus-log" id="focus-log"></div>
        </div>
      </div>`;

    focusPaintDropdown();
    renderFocusLog();

    document.getElementById('fp-back')?.addEventListener('click', () => navigateTo('dashboard'));

    page.querySelectorAll('[data-fp-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.focus.preset = btn.dataset.fpPreset;
        page.querySelectorAll('[data-fp-preset]').forEach(b => b.classList.toggle('active', b === btn));
        const t = document.getElementById('fp-idle-time');
        if (t) t.textContent = btn.dataset.fpPreset === 'deep' ? '50:00' : '25:00';
      });
    });
    document.getElementById('fp-start-btn')?.addEventListener('click', () => {
      startFocusSession(state.focus.preset || 'quick');
    });
    return;
  }

  const cfg = FOCUS_PRESETS[f.preset];
  const remaining = Math.max(0, focusRemainingSec());
  const R = 88, CIRC = 2 * Math.PI * R;
  const elapsedFrac = f.phaseDurationSec ? 1 - Math.max(0, Math.min(1, remaining / f.phaseDurationSec)) : 0;
  const isWork = f.phase === 'work';
  const project = focusLinkedProject();

  page.innerHTML = `
    <div class="fp-wrap fp-running">
      <button class="td-back-btn fp-back-btn" id="fp-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6"></polyline></svg>
        الرئيسية
      </button>
      <div class="fp-phase-badge ${isWork ? '' : 'is-break'}">${isWork ? '🎯 تركيز' : '☕ راحة'} · ${cfg.label}</div>
      ${project ? `<div class="fp-project-badge">📁 ${escapeHtml(project.name || '')}</div>` : ''}

      <div class="fp-ring-area">
        <div class="fp-ring-wrap">
          <svg class="fp-ring-svg" viewBox="0 0 200 200">
            <circle class="fp-ring-track" cx="100" cy="100" r="${R}"></circle>
            <circle class="fp-ring-progress ${isWork ? '' : 'is-break'}" id="focus-ring-progress"
              cx="100" cy="100" r="${R}"
              stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * elapsedFrac).toFixed(1)}"></circle>
          </svg>
          <div class="fp-ring-inner">
            <div class="fp-ring-time" id="focus-ring-count">${focusFmtClock(remaining)}</div>
            <div class="fp-ring-label">${isWork ? 'دقيقة تركيز' : 'دقيقة راحة'}</div>
          </div>
        </div>
      </div>

      <div class="fp-run-btns">
        <button class="fp-btn-action" type="button" data-focus-action="${f.pausedAt ? 'resume' : 'pause'}">
          ${f.pausedAt ? '▶ استكمال' : '⏸ إيقاف'}
        </button>
        <button class="fp-btn-reset" type="button" data-focus-action="reset">■ إعادة</button>
      </div>

      <div class="fp-log-wrap">
        <div class="fp-log-heading">آخر الجلسات</div>
        <div class="focus-log" id="focus-log"></div>
      </div>
    </div>`;
  renderFocusLog();
  document.getElementById('fp-back')?.addEventListener('click', () => navigateTo('dashboard'));
}

function renderFocusLog() {
  const wrap = document.getElementById('focus-log');
  if (!wrap) return;
  const sessions = state.focus.recentSessions || [];
  if (!sessions.length) {
    wrap.innerHTML = `<div class="fp-log-empty">لسه مفيش جلسات</div>`;
    return;
  }
  wrap.innerHTML = sessions.map(s => {
    const proj = s.projectId ? state.allProjects.find(p => p.id === s.projectId) : null;
    const label = proj ? proj.name : 'بدون مشروع';
    return `<div class="fp-log-row">
      <span class="fp-log-dot ${s.preset === 'deep' ? 'deep' : ''}"></span>
      <span class="fp-log-name">${escapeHtml(label)}</span>
      <span class="fp-log-dur">${s.workMinutes} د</span>
    </div>`;
  }).join('');
}

let focusLogSubscribed = false;
function subscribeFocusLog() {
  if (focusLogSubscribed) return;
  focusLogSubscribed = true;
  const q = query(focusSessionsRef(), orderBy('completedAt', 'desc'), limit(5));
  onSnapshot(q, snap => {
    state.focus.recentSessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFocusLog();
  }, err => console.error('focus log listener:', err));
}

// ════════════════════════════════════════════════════════════════
//  TEAM SYSTEM
// ════════════════════════════════════════════════════════════════

// Started once at owner boot; keeps state.teamMembers live for dropdowns.
function subscribeTeamMembersPersistent() {
  if (state.teamMembersUnsub) return; // already running
  const q = query(teamMembersRef(), orderBy('addedAt', 'asc'));
  state.teamMembersUnsub = onSnapshot(q, snap => {
    state.teamMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.view === 'team') renderTeamView();
  }, err => console.error('team members listener:', err));
}

function subscribeTeamMembers() {
  // The persistent subscription already keeps state.teamMembers up to date.
  // Just re-render the view (data may already be present).
  if (state.teamMembersUnsub) {
    renderTeamView();
    return;
  }
  subscribeTeamMembersPersistent();
}

function renderTeamView() {
  const el = document.getElementById('view-team');
  if (!el) return;
  const members = state.teamMembers;

  el.innerHTML = `
    <div class="team-page">
      <button class="td-back-btn" id="team-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6"></polyline></svg>
        الرئيسية
      </button>
      <div class="team-header">
        <h2 class="team-title">أعضاء الفريق</h2>
        <button class="btn-primary" id="btn-add-member">＋ إضافة عضو</button>
      </div>

      <div class="team-add-form hidden" id="team-add-form">
        <div class="team-form-row">
          <input type="text" id="tm-name" class="form-input" placeholder="الاسم الكامل" maxlength="60" />
          <input type="email" id="tm-email" class="form-input" placeholder="البريد الإلكتروني (Google)" />
          <button class="btn-primary" id="btn-save-member">حفظ</button>
          <button class="btn-ghost" id="btn-cancel-member">إلغاء</button>
        </div>
      </div>

      ${members.length === 0
        ? `<div class="team-empty">لا يوجد أعضاء بعد — أضف أول عضو في فريقك</div>`
        : `<div class="team-list">
            ${members.map(m => `
              <div class="team-member-card" data-id="${m.id}">
                <div class="tm-avatar" style="background:${memberColor(m.email)}">${getInitials(m.name)}</div>
                <div class="tm-info">
                  <div class="tm-name">${escapeHtml(m.name)}</div>
                  <div class="tm-email">${escapeHtml(m.email)}</div>
                </div>
                <button class="tm-delete-btn" data-id="${m.id}" title="حذف العضو">✕</button>
              </div>`).join('')}
          </div>`
      }
    </div>`;

  document.getElementById('team-back')?.addEventListener('click', () => navigateTo('dashboard'));

  // Add member button
  document.getElementById('btn-add-member')?.addEventListener('click', () => {
    document.getElementById('team-add-form').classList.toggle('hidden');
    document.getElementById('tm-name')?.focus();
  });
  document.getElementById('btn-cancel-member')?.addEventListener('click', () => {
    document.getElementById('team-add-form').classList.add('hidden');
  });
  document.getElementById('btn-save-member')?.addEventListener('click', saveTeamMember);

  // Delete buttons
  el.querySelectorAll('.tm-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = state.teamMembers.find(m => m.id === btn.dataset.id)?.name || 'العضو';
      const ok = await confirmDialog({ title: 'حذف عضو', message: `هل تريد حذف "${name}" من الفريق؟`, icon: '🗑️', confirmText: 'حذف' });
      if (!ok) return;
      try {
        await deleteDoc(teamMemberDoc(btn.dataset.id));
        toast(`تم حذف ${name}`, 'success');
      } catch (err) {
        toast('حدث خطأ', 'error'); console.error(err);
      }
    });
  });
}

async function saveTeamMember() {
  const name  = document.getElementById('tm-name')?.value.trim();
  const email = document.getElementById('tm-email')?.value.trim().toLowerCase();
  if (!name)  { toast('أدخل اسم العضو', 'error'); return; }
  if (!email || !email.includes('@')) { toast('أدخل بريد إلكتروني صحيح', 'error'); return; }
  if (state.teamMembers.some(m => m.email === email)) { toast('هذا البريد مضاف بالفعل', 'error'); return; }
  const btn = document.getElementById('btn-save-member');
  btn.disabled = true; btn.textContent = '...';
  try {
    await addDoc(teamMembersRef(), { name, email, addedAt: serverTimestamp() });
    document.getElementById('tm-name').value = '';
    document.getElementById('tm-email').value = '';
    document.getElementById('team-add-form').classList.add('hidden');
    toast(`تمت إضافة ${name} ✅`, 'success');
  } catch (err) {
    toast('حدث خطأ', 'error'); console.error(err);
  } finally {
    btn.disabled = false; btn.textContent = 'حفظ';
  }
}

// Stable color from email string
function memberColor(email = '') {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

// ── My Tasks (member view) ─────────────────────────────────────

function subscribeMyTasks() {
  if (!currentUser?.email) return;
  if (state.myTasksUnsub) { renderMyTasksView(); return; } // already live
  const q = query(
    collectionGroup(db, 'tasks'),
    where('assignedTo.email', '==', currentUser.email)
  );
  state.myTasksUnsub = onSnapshot(q, snap => {
    state.myTasks = snap.docs.map(d => ({ id: d.id, _ref: d.ref, ...d.data() }));
    renderMyTasksView();
  }, err => console.error('my-tasks listener:', err));
}

function renderMyTasksView() {
  const el = document.getElementById('view-my-tasks');
  if (!el) return;
  const tasks = state.myTasks || [];
  const cols = [
    { status: 'todo',  label: '📋 للإنجاز',     tasks: tasks.filter(t => t.status === 'todo')  },
    { status: 'doing', label: '⚡ قيد التنفيذ',  tasks: tasks.filter(t => t.status === 'doing') },
    { status: 'done',  label: '✅ مكتمل',        tasks: tasks.filter(t => t.status === 'done')  },
  ];

  el.innerHTML = `
    <div class="my-tasks-greeting">أهلاً ${escapeHtml(currentUser?.name || '')} 👋</div>
    <div class="my-tasks-board">
      ${cols.map(col => `
        <div class="my-tasks-col">
          <div class="my-tasks-col-head">
            <span>${col.label}</span>
            <span class="my-tasks-count">${col.tasks.length}</span>
          </div>
          <div class="my-tasks-body">
            ${col.tasks.length === 0
              ? `<div class="my-tasks-empty">لا يوجد</div>`
              : col.tasks.map(t => myTaskCardHTML(t)).join('')}
          </div>
        </div>`).join('')}
    </div>`;

  // Click card → detail (member view, read path parsed from ref)
  el.querySelectorAll('.mt-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button, .mt-action-btn')) return;
      const taskId = card.dataset.id;
      const task   = state.myTasks?.find(t => t.id === taskId);
      if (!task || !task._ref) return;
      const parts = task._ref.path.split('/');
      // path: clients/{cId}/projects/{pId}/tasks/{tId}
      const fakeClient  = { id: parts[1], name: '' };
      const fakeProject = { id: parts[3], name: '' };
      navigateTo('task-detail', { client: fakeClient, project: fakeProject, task, fromMember: true });
    });
  });

  el.querySelectorAll('[data-mt-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, ref } = btn.dataset;
      const newStatus   = btn.dataset.mtStatus;
      const taskRef     = state.myTasks?.find(t => t.id === id)?._ref;
      if (!taskRef) return;
      btn.disabled = true;
      try {
        await updateDoc(taskRef, { status: newStatus });
      } catch (err) {
        toast('فشل التحديث', 'error'); console.error(err);
        btn.disabled = false;
      }
    });
  });
}

function myTaskCardHTML(task) {
  const nextStatus = task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : null;
  const actionBtn  = nextStatus
    ? `<button class="mt-action-btn" data-id="${task.id}" data-mt-status="${nextStatus}">
        ${nextStatus === 'doing' ? 'ابدأ ⚡' : 'أنهيت ✅'}
      </button>`
    : `<span class="mt-done-chip">مكتمل ✅</span>`;

  const endDate = task.endDate ? formatDate(task.endDate) : null;
  return `
    <div class="mt-card${task.status === 'done' ? ' mt-done' : ''}" data-id="${task.id}" style="cursor:pointer">
      <div class="mt-card-title">${escapeHtml(task.title)}</div>
      ${task.notes ? `<div class="mt-card-notes">${escapeHtml(task.notes)}</div>` : ''}
      <div class="mt-card-footer">
        ${endDate ? `<span class="mt-due">📅 ${endDate}</span>` : ''}
        ${task.priority ? `<span class="card-priority priority-${task.priority}">${priorityLabel(task.priority)}</span>` : ''}
        ${actionBtn}
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
//  TASK DETAIL — Notion-style
// ════════════════════════════════════════════════════════════════

function subscribeTaskDetail() {
  const { client, project, task } = state.taskDetail;
  if (!client || !project || !task) return;

  const sq = query(subtasksRef(client.id, project.id, task.id), orderBy('createdAt', 'asc'));
  state.taskDetail.subtasksUnsub = onSnapshot(sq, snap => {
    state.taskDetail.subtasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTaskDetailSubtasks();
  });

  const cq = query(commentsRef(client.id, project.id, task.id), orderBy('createdAt', 'asc'));
  state.taskDetail.commentsUnsub = onSnapshot(cq, snap => {
    state.taskDetail.comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTaskDetailComments();
  });

  renderTaskDetail();
}

const STATUS_CYCLE = { todo: 'doing', doing: 'done', done: 'todo' };
const STATUS_LABEL = { todo: '📋 للإنجاز', doing: '⚡ قيد التنفيذ', done: '✅ مكتمل' };

function renderTaskDetail() {
  const el = document.getElementById('view-task-detail');
  if (!el) return;
  const { task, client, project, fromMember } = state.taskDetail;
  if (!task) { el.innerHTML = '<div style="padding:32px;color:var(--text-muted)">لم يتم تحديد مهمة</div>'; return; }

  const isOwner = currentUser?.role === 'owner';
  const backView = fromMember ? 'my-tasks' : 'tasks';

  const startStr = task.startDate ? formatDate(task.startDate) : null;
  const endStr   = task.endDate   ? formatDate(task.endDate)   : null;
  const aColor   = task.assignedTo?.email ? memberColor(task.assignedTo.email) : null;

  const priorityLabel2 = task.priority ? priorityLabel(task.priority) : null;

  el.innerHTML = `
    <div class="td-page">

      <!-- Back -->
      <button class="td-back-btn" data-back="${backView}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="15 18 9 12 15 6"></polyline></svg>
        ${fromMember ? 'مهامي' : escapeHtml(project?.name || 'المهام')}
      </button>

      <!-- Title -->
      <div class="td-title${isOwner ? ' td-title-editable' : ''}"
        ${isOwner ? 'contenteditable="true" spellcheck="false"' : ''}
        id="td-title-field">${escapeHtml(task.title)}</div>

      <!-- Properties table (Notion-style) -->
      <div class="td-props-table">
        <div class="td-prop-row">
          <span class="td-prop-key">الحالة</span>
          <span class="td-prop-val">
            <button class="td-status-chip td-status-${task.status}" id="td-status-pill"
              ${isOwner ? 'title="اضغط لتغيير الحالة"' : 'disabled'}>
              ${STATUS_LABEL[task.status] || task.status}
            </button>
          </span>
        </div>
        ${priorityLabel2 ? `
        <div class="td-prop-row">
          <span class="td-prop-key">الأولوية</span>
          <span class="td-prop-val"><span class="td-chip td-chip-neutral">${priorityLabel2}</span></span>
        </div>` : ''}
        <div class="td-prop-row">
          <span class="td-prop-key">المُعيَّن</span>
          <span class="td-prop-val">
            ${aColor
              ? `<span class="td-chip" style="background:${aColor};color:#fff">👤 ${escapeHtml(task.assignedTo.name)}</span>`
              : `<span class="td-chip td-chip-empty">غير مُعيَّن</span>`}
          </span>
        </div>
        <div class="td-prop-row">
          <span class="td-prop-key">المشروع</span>
          <span class="td-prop-val"><span class="td-chip td-chip-neutral">📁 ${escapeHtml(project?.name || '—')}</span></span>
        </div>
        ${startStr ? `
        <div class="td-prop-row">
          <span class="td-prop-key">التاريخ</span>
          <span class="td-prop-val"><span class="td-chip td-chip-neutral">📅 ${startStr}${endStr ? ' ← ' + endStr : ''}</span></span>
        </div>` : ''}
      </div>

      <div class="td-divider"></div>

      <!-- Body -->
      <div class="td-body">

        <!-- Description -->
        <div class="td-section">
          <div class="td-section-label">الوصف</div>
          <textarea class="td-description" id="td-description"
            placeholder="أضف وصفاً للمهمة..."
            ${!isOwner ? 'readonly' : ''}>${escapeHtml(task.description || '')}</textarea>
        </div>

        <!-- Subtasks -->
        <div class="td-section">
          <div class="td-section-label">المهام الفرعية <span class="td-count" id="td-subtask-count"></span></div>
          <div id="td-subtasks-list"></div>
          ${isOwner ? `
          <div class="td-subtask-add-row">
            <input type="text" id="td-new-subtask" class="td-subtask-input" placeholder="اكتب اسم المهمة الفرعية..." maxlength="120" />
            <button class="td-subtask-add-btn" id="td-add-subtask-btn">+ إضافة</button>
          </div>` : ''}
        </div>

        <!-- Comments -->
        <div class="td-section">
          <div class="td-section-label">التعليقات</div>
          <div id="td-comments-list"></div>
          <div class="td-comment-form">
            <div class="td-comment-av" style="background:${memberColor(currentUser?.email || '')}">${getInitials(currentUser?.name || '?')}</div>
            <input type="text" id="td-new-comment" class="td-comment-input" placeholder="اكتب تعليقاً..." maxlength="300" />
            <button class="td-send-btn" id="td-send-comment">إرسال</button>
          </div>
        </div>

      </div>
    </div>`;

  // Back button
  el.querySelector('.td-back-btn')?.addEventListener('click', () => {
    navigateTo(backView, { client: state.taskDetail.client, project: state.taskDetail.project });
  });

  // Status pill click (owner: cycle status)
  if (isOwner) {
    el.querySelector('#td-status-pill')?.addEventListener('click', async () => {
      const { client: c, project: p, task: t } = state.taskDetail;
      const next = STATUS_CYCLE[t.status] || 'todo';
      try {
        await updateDoc(taskDoc(c.id, p.id, t.id), { status: next });
        state.taskDetail.task = { ...t, status: next };
        renderTaskDetail();
      } catch (err) { toast('فشل التحديث', 'error'); }
    });

    // Title auto-save on blur
    el.querySelector('#td-title-field')?.addEventListener('blur', async (e) => {
      const newTitle = e.target.innerText.trim();
      if (!newTitle || newTitle === state.taskDetail.task.title) return;
      try {
        const { client: c, project: p, task: t } = state.taskDetail;
        await updateDoc(taskDoc(c.id, p.id, t.id), { title: newTitle });
        state.taskDetail.task = { ...t, title: newTitle };
      } catch (err) { toast('فشل حفظ العنوان', 'error'); e.target.innerText = state.taskDetail.task.title; }
    });
    // Prevent newlines in title
    el.querySelector('#td-title-field')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });

    // Description auto-save on blur
    el.querySelector('#td-description')?.addEventListener('blur', async (e) => {
      const newDesc = e.target.value.trim();
      if (newDesc === (state.taskDetail.task.description || '')) return;
      try {
        const { client: c, project: p, task: t } = state.taskDetail;
        await updateDoc(taskDoc(c.id, p.id, t.id), { description: newDesc });
        state.taskDetail.task = { ...t, description: newDesc };
      } catch (err) { toast('فشل حفظ الوصف', 'error'); }
    });

    // Add subtask on Enter or button click
    const doAddSubtask = async () => {
      const inp = el.querySelector('#td-new-subtask');
      const title = inp?.value.trim();
      if (!title) return;
      inp.value = '';
      inp.focus();
      const { client: c, project: p, task: t } = state.taskDetail;
      try {
        await addDoc(subtasksRef(c.id, p.id, t.id), { title, done: false, createdAt: serverTimestamp() });
      } catch (err) { toast('فشل إضافة المهمة الفرعية', 'error'); }
    };
    el.querySelector('#td-new-subtask')?.addEventListener('keydown', e => { if (e.key === 'Enter') doAddSubtask(); });
    el.querySelector('#td-add-subtask-btn')?.addEventListener('click', doAddSubtask);
  }

  // Send comment
  const sendComment = async () => {
    const inp = el.querySelector('#td-new-comment');
    const text = inp?.value.trim();
    if (!text) return;
    inp.value = '';
    const { client: c, project: p, task: t } = state.taskDetail;
    try {
      await addDoc(commentsRef(c.id, p.id, t.id), {
        text,
        authorName:  currentUser?.name  || 'مجهول',
        authorEmail: currentUser?.email || '',
        createdAt: serverTimestamp(),
      });
    } catch (err) { toast('فشل إرسال التعليق', 'error'); inp.value = text; }
  };
  el.querySelector('#td-send-comment')?.addEventListener('click', sendComment);
  el.querySelector('#td-new-comment')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
  });

  // Render sub-lists
  renderTaskDetailSubtasks();
  renderTaskDetailComments();
}

function renderTaskDetailSubtasks() {
  const list   = document.getElementById('td-subtasks-list');
  const count  = document.getElementById('td-subtask-count');
  if (!list) return;
  const { subtasks, client, project, task } = state.taskDetail;
  const isOwner = currentUser?.role === 'owner';
  const done  = subtasks.filter(s => s.done).length;
  if (count) count.textContent = subtasks.length ? `${done}/${subtasks.length}` : '';

  list.innerHTML = subtasks.map(s => `
    <div class="td-subtask-row${s.done ? ' td-subtask-done' : ''}">
      <input type="checkbox" class="td-subtask-cb" data-id="${s.id}" ${s.done ? 'checked' : ''} />
      <span class="td-subtask-title">${escapeHtml(s.title)}</span>
      ${isOwner ? `<button class="td-subtask-del" data-id="${s.id}" title="حذف">✕</button>` : ''}
    </div>`).join('') || '<div class="td-empty-hint">لا يوجد مهام فرعية بعد</div>';

  list.querySelectorAll('.td-subtask-cb').forEach(cb => {
    cb.addEventListener('change', async () => {
      try {
        await updateDoc(subtaskDoc(client.id, project.id, task.id, cb.dataset.id), { done: cb.checked });
      } catch (err) { toast('فشل التحديث', 'error'); cb.checked = !cb.checked; }
    });
  });

  if (isOwner) {
    list.querySelectorAll('.td-subtask-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await deleteDoc(subtaskDoc(client.id, project.id, task.id, btn.dataset.id)); }
        catch (err) { toast('فشل الحذف', 'error'); }
      });
    });
  }
}

function renderTaskDetailComments() {
  const list = document.getElementById('td-comments-list');
  if (!list) return;
  const { comments } = state.taskDetail;
  list.innerHTML = comments.map(c => `
    <div class="td-comment">
      <div class="td-comment-av" style="background:${memberColor(c.authorEmail)}">${getInitials(c.authorName)}</div>
      <div class="td-comment-body">
        <div class="td-comment-meta">
          <span class="td-comment-author">${escapeHtml(c.authorName)}</span>
          <span class="td-comment-time">${formatDate(c.createdAt)}</span>
        </div>
        <div class="td-comment-text">${escapeHtml(c.text)}</div>
      </div>
    </div>`).join('') || '<div class="td-empty-hint">لا توجد تعليقات بعد</div>';
}

// ════════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS (FCM)
// ════════════════════════════════════════════════════════════════

async function registerForNotifications(memberId) {
  if (!messaging || !memberId) return;
  if (vapidKey === 'PASTE_YOUR_VAPID_KEY_HERE') return; // not configured yet

  try {
    // Register the service worker first
    const sw = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Get FCM token
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: sw });
    if (!token) return;

    // Save token to Firestore on the member's doc
    await updateDoc(teamMemberDoc(memberId), { fcmToken: token });

    // Show foreground notifications (tab is open)
    onMessage(messaging, payload => {
      const n = payload.notification || {};
      toast(`${n.title || ''}: ${n.body || ''}`, 'info', '🔔');
    });

  } catch (err) {
    console.warn('FCM registration error:', err);
  }
}

function focusPaintDropdown() {
  const text = document.getElementById('focus-dd-text');
  const note = document.getElementById('focus-orb-time-note');
  if (!text) return;
  const options = state.focus.projectOptions || [];
  const opt = options.find(o => o.id === state.focus.projectId);
  text.textContent = opt ? opt.label : 'بدون مشروع';
  text.classList.toggle('placeholder', !opt);
  if (note) note.textContent = opt ? `مسجل عليه: ${formatHours(opt.hours)}` : '';
  document.querySelectorAll('#focus-dd-menu .focus-dd-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.value === (state.focus.projectId || ''));
  });
}

function focusCloseDropdown() {
  const menu = document.getElementById('focus-dd-menu');
  const trigger = document.querySelector('#focus-project-dd .focus-dd-trigger');
  menu?.classList.remove('open');
  trigger?.setAttribute('aria-expanded', 'false');
}

(function initFocusEvents() {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('#focus-project-dd .focus-dd-trigger');
    if (trigger) {
      const menu = document.getElementById('focus-dd-menu');
      const willOpen = !menu.classList.contains('open');
      menu.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
      return;
    }
    const ddItem = e.target.closest('#focus-dd-menu .focus-dd-item');
    if (ddItem) {
      state.focus.projectId = ddItem.dataset.value || null;
      focusPaintDropdown();
      focusCloseDropdown();
      return;
    }
    if (!e.target.closest('#focus-project-dd')) focusCloseDropdown();

    const actionBtn = e.target.closest('#view-focus [data-focus-action]');
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
      projectId: data.projectId || null,
      clientId: data.clientId || null,
    });
    const remaining = focusRemainingSec();
    if (remaining <= 0) { await focusCompletePhase(); return; }
    renderFocusPage();
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

  grid.innerHTML = filtered.map(client => {
    const avBg = client.avatarUrl ? 'transparent' : escapeHtml(client.color || '#3574F0');
    const avContent = client.avatarUrl
      ? `<img src="${client.avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : escapeHtml(getInitials(client.name));
    return `
    <div class="nl-entity-row" data-id="${client.id}" role="button" tabindex="0" draggable="true">
      <span class="nl-entity-av" style="background:${avBg}">${avContent}</span>
      <span class="nl-entity-name">${escapeHtml(client.name)}</span>
      ${client.description ? `<span class="nl-entity-desc">${escapeHtml(client.description)}</span>` : '<span></span>'}
      <span class="nl-entity-date">${formatDate(client.createdAt)}</span>
      <div class="nl-entity-actions">
        <button class="card-edit-btn" data-id="${client.id}" title="تعديل">✏️</button>
        <button class="card-del-btn" data-id="${client.id}" title="حذف">🗑️</button>
      </div>
    </div>`;
  }).join('');

  // Events
  grid.querySelectorAll('.nl-entity-row[data-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-del-btn') || e.target.closest('.card-edit-btn')) return;
      const client = state.clients.find(c => c.id === card.dataset.id);
      if (client) navigateTo('projects', { client });
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') card.click(); });
  });

  // Drag & Drop for Clients
  grid.querySelectorAll('.nl-entity-row[data-id]').forEach(card => {
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
      grid.querySelectorAll('.nl-entity-row').forEach(c => c.classList.remove('drag-over-card'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (state.draggedEntityType !== 'client' || state.draggedEntityId === card.dataset.id) return;
      card.classList.add('drag-over-card');
    });
    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over-card');
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
    const clientId   = project._clientId || state.client?.id;
    const client     = state.clients.find(c => c.id === clientId);
    const clientName = client?.name || '';
    const projectTasks = state.tasks.filter(t => t._projectId === project.id);
    const doneTasks    = projectTasks.filter(t => t.status === 'done').length;
    const totalTasks   = projectTasks.length;
    const pct          = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const projHours    = Number(project.totalProjectHours) || 0;
    const progressColor = pct < 30 ? 'var(--danger)' : pct < 75 ? '#F0A835' : '#3DB981';

    return `
      <div class="nl-entity-row nl-proj-row" data-id="${project.id}" role="button" tabindex="0" draggable="true">
        <span class="nl-proj-status-dot ${st.cls || 'status-active'}" title="${st.label}"></span>
        <span class="nl-entity-name">${escapeHtml(project.name)}</span>
        ${clientName ? `<span class="nl-proj-client">${escapeHtml(clientName)}</span>` : '<span></span>'}
        <div class="nl-proj-progress" title="${pct}% مكتمل">
          <div class="nl-prog-bar"><div class="nl-prog-fill" style="width:${pct}%;background:${progressColor}"></div></div>
          <span class="nl-prog-label">${doneTasks}/${totalTasks}</span>
        </div>
        <span class="nl-proj-hours">⏱ ${formatHoursHm(projHours)}</span>
        <div class="nl-entity-actions">
          <button class="card-edit-btn" data-id="${project.id}" title="تعديل">✏️</button>
          <button class="card-del-btn" data-id="${project.id}" title="حذف">🗑️</button>
        </div>
      </div>`;
  }).join('');

  // Click: navigate to tasks
  grid.querySelectorAll('.nl-proj-row[data-id]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.card-del-btn') || e.target.closest('.card-edit-btn')) return;
      const project = state.projects.find(p => p.id === card.dataset.id);
      if (project) {
        const clientId = project._clientId || state.client?.id;
        const client = state.clients.find(c => c.id === clientId) || state.client;
        navigateTo('tasks', { client, project, fromProjectsAll: !state.client });
      }
    });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') card.click(); });
  });

  // Drag & Drop for Projects
  grid.querySelectorAll('.nl-proj-row[data-id]').forEach(card => {
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
      grid.querySelectorAll('.nl-proj-row').forEach(c => c.classList.remove('drag-over-card'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (state.draggedEntityType !== 'project' || state.draggedEntityId === card.dataset.id) return;
      card.classList.add('drag-over-card');
    });
    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over-card');
    });
    card.addEventListener('drop', async e => {
      e.preventDefault();
      card.classList.remove('drag-over-card');
      if (state.draggedEntityType !== 'project' || !state.draggedEntityId || state.draggedEntityId === card.dataset.id) return;
      const draggedProject  = state.projects.find(p => p.id === state.draggedEntityId);
      const targetProject   = state.projects.find(p => p.id === card.dataset.id);
      const draggedClientId = draggedProject?._clientId || state.client?.id;
      const targetClientId  = targetProject?._clientId  || state.client?.id;
      if (!draggedClientId || !targetClientId) return;
      if (draggedClientId !== targetClientId) { toast('لا يمكن إعادة ترتيب مشاريع عملاء مختلفين', 'error'); return; }
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
  const isOwner = currentUser?.role === 'owner';
  const planToggle = `<button class="card-plan-btn" data-id="${task.id}" title="${task.inPlan ? 'إزالة من الخطة' : 'إضافة للخطة'}">${task.inPlan ? '★' : '☆'}</button>`;
  const editBtn = isOwner ? `<button class="card-edit-btn" data-id="${task.id}" title="تعديل">✏️</button>` : '';
  const delBtn  = isOwner ? `<button class="card-menu-btn" data-id="${task.id}" title="حذف">✕</button>` : '';
  const endDate = task.endDate ? `<span class="nl-date">${formatDate(task.endDate)}</span>` : '';

  let assigneeBtn = '';
  if (task.assignedTo?.email) {
    const col = memberColor(task.assignedTo.email);
    assigneeBtn = `<button class="nl-assignee" data-assign="${task.id}" style="background:${col}" title="${escapeHtml(task.assignedTo.name)}">${getInitials(task.assignedTo.name)}</button>`;
  } else if (isOwner) {
    assigneeBtn = `<button class="nl-assignee nl-assignee-empty" data-assign="${task.id}" title="عيّن عضو">+</button>`;
  }

  return `
    <div class="task-card${task.inPlan ? ' in-plan' : ''}" id="tc-${task.id}" draggable="true" data-id="${task.id}">
      <span class="tc-dot"></span>
      <span class="card-title">${escapeHtml(task.title)}</span>
      <div class="nl-row-props">
        ${endDate}
        ${assigneeBtn}
        ${planToggle}
        ${editBtn}
        ${delBtn}
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

  // Assignee quick-assign dropdown
  colEl.querySelectorAll('[data-assign]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.nl-assign-dd').forEach(d => d.remove());
      const taskId = btn.dataset.assign;
      const task   = state.tasks.find(t => t.id === taskId);
      if (!task) return;

      const dd = document.createElement('div');
      dd.className = 'nl-assign-dd';

      const members = state.teamMembers || [];
      let html = members.map(m => {
        const col = memberColor(m.email);
        return `<div class="nl-assign-item" data-email="${m.email}" data-name="${escapeHtml(m.name)}" data-mid="${m.id}">
          <span class="nl-assign-av" style="background:${col}">${getInitials(m.name)}</span>
          ${escapeHtml(m.name)}
        </div>`;
      }).join('');
      if (task.assignedTo?.email) {
        html += `<div class="nl-assign-item nl-assign-none" data-email="" data-name="">— إزالة التعيين</div>`;
      }
      dd.innerHTML = html;

      // Position below the button
      const rect = btn.getBoundingClientRect();
      dd.style.position = 'fixed';
      dd.style.top  = (rect.bottom + 6) + 'px';
      dd.style.left = (rect.left - 120) + 'px';
      document.body.appendChild(dd);

      dd.querySelectorAll('.nl-assign-item').forEach(item => {
        item.addEventListener('click', async ev => {
          ev.stopPropagation();
          dd.remove();
          const email = item.dataset.email;
          const name  = item.dataset.name;
          const memberId = item.dataset.mid || null;
          const ref   = doc(db, 'clients', state.client.id, 'projects', state.project.id, 'tasks', taskId);
          await updateDoc(ref, { assignedTo: email ? { email, name, memberId } : null });
        });
      });

      const close = ev => { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('click', close); } };
      setTimeout(() => document.addEventListener('click', close), 0);
    });
  });

  colEl.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button, input')) return;
      const task = state.tasks.find(t => t.id === card.dataset.id);
      if (!task) return;
      navigateTo('task-detail', { client: state.client, project: state.project, task });
    });
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

  } else if (state.view === 'focus') {
    titleEl.textContent = '⏱ فوكس تايمر';
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';

  } else if (state.view === 'task-detail') {
    titleEl.textContent = `📄 ${escapeHtml(state.taskDetail.task?.title || 'تفاصيل المهمة')}`;
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';

  } else if (state.view === 'team') {
    titleEl.textContent = '🤝 الفريق';
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';

  } else if (state.view === 'my-tasks') {
    titleEl.textContent = `📋 مهامي — ${escapeHtml(currentUser?.name || '')}`;
    statsEl.innerHTML   = '';
    actionsEl.innerHTML = '';
  }
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  if (state.view === 'dashboard' || state.view === 'clients' || state.view === 'focus' || state.view === 'team' || state.view === 'my-tasks' || state.view === 'task-detail' || (state.view === 'projects' && !state.client)) {
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
      </div>
      <div class="form-group" id="task-assignee-group">
        <label class="form-label">تعيين لعضو الفريق (اختياري)</label>
        <select id="f-assignee" class="form-select">
          <option value="">— بدون —</option>
        </select>
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

  if (type === 'task') {
    // Default startDate to today (LOCAL — not UTC, fixes day-1 bug)
    if (!state.editTarget) {
      const sd = document.getElementById('f-start-date');
      if (sd) sd.value = toLocalISODate(new Date());
    }
    // Populate assignee dropdown from team members
    const assigneeGroup = document.getElementById('task-assignee-group');
    const assigneeSel   = document.getElementById('f-assignee');
    if (assigneeSel && state.teamMembers.length > 0) {
      assigneeSel.innerHTML = `<option value="">— بدون —</option>` +
        state.teamMembers.map(m => `<option value="${m.id}" data-name="${escapeHtml(m.name)}" data-email="${escapeHtml(m.email)}">${escapeHtml(m.name)}</option>`).join('');
      if (assigneeGroup) assigneeGroup.style.display = '';
    } else if (assigneeGroup) {
      assigneeGroup.style.display = 'none';
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

    // Prefill assignee
    const assigneeSel = document.getElementById('f-assignee');
    if (assigneeSel && task.assignedTo?.memberId) {
      assigneeSel.value = task.assignedTo.memberId;
    }

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

      // Build assignedTo from dropdown
      const assigneeSel   = document.getElementById('f-assignee');
      const assigneeId    = assigneeSel?.value || null;
      const assigneeOpt   = assigneeId ? assigneeSel.querySelector(`option[value="${assigneeId}"]`) : null;
      const assignedTo    = assigneeId && assigneeOpt
        ? { memberId: assigneeId, name: assigneeOpt.dataset.name, email: assigneeOpt.dataset.email }
        : null;

      if (state.editTarget) {
        const updateData = { title, priority, notes, startDate, endDate, assignedTo };
        if (imageData !== undefined) updateData.imageUrl = imageData;
        await updateDoc(taskDoc(state.client.id, state.project.id, state.editTarget.id), updateData);
        toast('تم تعديل المهمة بنجاح! 🎉', 'success');
      } else {
        await addDoc(tasksRef(state.client.id, state.project.id), {
          title, priority, notes, startDate, endDate, assignedTo,
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

