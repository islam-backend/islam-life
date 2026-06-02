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
    state.timeLogs = [];
    state.client = null;
    state.project = null;

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
const navHours     = document.getElementById('nav-hours');

if (navDashboard) {
  navDashboard.addEventListener('click', () => navigateTo('dashboard'));
}
if (navClients) {
  navClients.addEventListener('click', () => navigateTo('clients'));
}
if (navHours) {
  navHours.addEventListener('click', () => navigateTo('hours'));
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
const timeLogsRef = ()                         => collection(db, 'timeLogs');
const timeLogDoc  = (id)                       => doc(db, 'timeLogs', id);

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
  projUnsub:         null,
  taskUnsub:         null,
  draggedId:   null,
  draggedEntityId:   null,
  draggedEntityType: null,
  search:      '',
  deleteTarget: null,
  editTarget:   null,
  unsubscribe: null,
  // Hours Tracker State (v6.0)
  timeLogs:        [],
  timeLogsUnsub:   null,
};

// ── Cleanup Listeners ──────────────────────────────────────────
function cleanupListeners() {
  const safeUnsub = (fn) => {
    try { if (typeof fn === 'function') fn(); } catch (e) { console.error('Unsub failed:', e); }
  };
  safeUnsub(state.unsubscribe);        state.unsubscribe = null;
  safeUnsub(state.dashUnsubProjects);  state.dashUnsubProjects = null;
  safeUnsub(state.dashUnsubTasks);     state.dashUnsubTasks = null;
  safeUnsub(state.projUnsub);          state.projUnsub = null;
  safeUnsub(state.taskUnsub);          state.taskUnsub = null;
  safeUnsub(state.timeLogsUnsub);      state.timeLogsUnsub = null;
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
  const showHoursActive   = (view === 'hours');

  document.getElementById('nav-dashboard')?.classList.toggle('active', !!showDashActive);
  document.getElementById('nav-clients')?.classList.toggle('active', !!showClientsActive);
  document.getElementById('nav-hours')?.classList.toggle('active', !!showHoursActive);

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

  } else if (view === 'hours') {
    state.client  = null;
    state.project = null;
    document.getElementById('view-hours').classList.add('active');
    subscribeHours();

  } else if (view === 'tasks') {
    if (payload.client)  state.client  = payload.client;
    if (payload.project) state.project = payload.project;
    document.getElementById('view-tasks').classList.add('active');
    subscribeTasks();
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
    renderDashboard();
  }, err => { setOffline(); hideLoading(); console.error(err); });

  // 1. Listen to all projects across all clients via collectionGroup
  const projQ = query(collectionGroup(db, 'projects'));
  state.dashUnsubProjects = onSnapshot(projQ, snap => {
    setOnline(); hideLoading();
    state.allProjects = snap.docs.map(d => ({ id: d.id, ...d.data(), _ref: d.ref }));
    renderDashboard();
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });

  // 2. Listen to all tasks across all projects via collectionGroup
  const taskQ = query(collectionGroup(db, 'tasks'));
  state.dashUnsubTasks = onSnapshot(taskQ, snap => {
    setOnline(); hideLoading();
    state.allTasks = snap.docs.map(d => ({ id: d.id, ...d.data(), _projectId: d.ref.parent.parent.id, _clientId: d.ref.parent.parent.parent.parent.id }));
    renderDashboard();
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
      renderProjects();
    }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });
    
    // Also load all tasks for these projects to show progress
    state.taskUnsub = onSnapshot(query(collectionGroup(db, 'tasks')), taskSnap => {
      state.tasks = taskSnap.docs.map(t => ({ id: t.id, ...t.data(), _projectId: t.ref.parent.parent.id }));
      renderProjects();
    }, err => console.error(err));
  } else {
    // 2. All projects mode
    const clientQ = query(clientsRef(), orderBy('createdAt', 'desc'));
    state.unsubscribe = onSnapshot(clientQ, snap => {
      setOnline(); hideLoading();
      state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const badge = document.getElementById('total-badge');
    if (badge) badge.textContent = state.clients.length;
      renderProjects();
    }, err => { setOffline(); hideLoading(); console.error(err); });
    
    state.projUnsub = onSnapshot(query(collectionGroup(db, 'projects')), projSnap => {
      state.projects = projSnap.docs.map(d => ({ 
        id: d.id, 
        ...d.data(), 
        _ref: d.ref, 
        _clientId: d.ref.parent.parent.id 
      }));
      renderProjects();
    }, err => console.error(err));
    
    state.taskUnsub = onSnapshot(query(collectionGroup(db, 'tasks')), taskSnap => {
      state.tasks = taskSnap.docs.map(t => ({ id: t.id, ...t.data(), _projectId: t.ref.parent.parent.id }));
      renderProjects();
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
    renderKanban();
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });
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

  // ── Count stats ──
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
      const mins = project.totalMinutesSpent || 0;
      const timeBadge = mins > 0 ? `<span class="proj-strip-pct-badge" style="color: var(--accent); border-color: rgba(53,116,240,0.2); background: rgba(53,116,240,0.06);" title="الوقت المستغرق">⏱️ ${formatMinutes(mins)}</span>` : '';

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

    // Time spent badge
    const mins = project.totalMinutesSpent || 0;
    const timeBadge = mins > 0 ? `<div class="time-spent-badge" style="margin-top: 0;" title="الوقت المستغرق">⏱️ ${formatMinutes(mins)}</div>` : '';

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

function renderKanban() {
  const q        = state.search.toLowerCase();
  const filtered = q
    ? state.tasks.filter(t => t.title?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))
    : state.tasks;

  const groups = { todo: [], doing: [], done: [] };
  filtered.forEach(t => { if (groups[t.status]) groups[t.status].push(t); });

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
  const mins = task.totalMinutesSpent || 0;
  const timeBadge = mins > 0 ? `<div class="time-spent-badge" title="الوقت المسجل للمهمة">⏱️ ${formatMinutes(mins)}</div>` : '';

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
      <div class="card-footer" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
        <span class="card-date">🕐 ${formatDate(task.createdAt)}</span>
        ${task.priority ? `<span class="card-priority priority-${task.priority}">${priorityLabel(task.priority)}</span>` : ''}
        ${timeBadge}
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

  } else if (state.view === 'hours') {
    titleEl.textContent  = '📊 تتبع الساعات';
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
  }
}

function updateBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  if (state.view === 'dashboard' || state.view === 'hours' || state.view === 'clients' || (state.view === 'projects' && !state.client)) {
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
  hours: {
    title:      '⏱️ تسجيل ساعات عمل',
    submitText: 'حفظ السجل',
    fields: `
      <div class="form-group">
        <label class="form-label">العميل <span class="required">*</span></label>
        <select id="f-client-id" class="form-select" required>
          <option value="">-- اختر العميل --</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">المشروع <span class="required">*</span></label>
        <select id="f-project-id" class="form-select" required disabled>
          <option value="">-- اختر المشروع --</option>
        </select>
      </div>
      <div class="form-row" style="display:flex; gap:10px;">
        <div class="form-group" style="flex:1;">
          <label class="form-label">عدد الساعات <span class="required">*</span></label>
          <input type="number" id="f-hours" class="form-input"
            placeholder="مثال: 1.5" min="0.25" max="24" step="0.25" required />
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input type="date" id="f-date" class="form-input" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">وصف العمل (اختياري)</label>
        <textarea id="f-description" class="form-textarea"
          placeholder="مثال: تصميم الصفحة الرئيسية ومراجعة المحتوى" maxlength="300"></textarea>
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
  }

  if (type === 'hours') {
    // Populate client dropdown
    const clientSel = document.getElementById('f-client-id');
    const projectSel = document.getElementById('f-project-id');
    if (clientSel) {
      clientSel.innerHTML = '<option value="">-- اختر العميل --</option>' +
        state.clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      clientSel.addEventListener('change', () => {
        const cId = clientSel.value;
        if (!cId || !projectSel) return;
        const projects = state.allProjects.filter(p => (p._clientId || p._ref?.parent?.parent?.id) === cId);
        projectSel.innerHTML = '<option value="">-- اختر المشروع --</option>' +
          projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        if (projects.length > 0) {
          projectSel.removeAttribute('disabled');
        } else {
          projectSel.setAttribute('disabled', 'true');
        }
      });
    }
    // Default date = today (YYYY-MM-DD format for <input type="date">)
    const dateEl = document.getElementById('f-date');
    if (dateEl) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      dateEl.value = `${yyyy}-${mm}-${dd}`;
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
    
  } else if (type === 'task') {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    document.getElementById('f-title').value = task.title || '';
    const priorityEl = document.getElementById('f-priority');
    if (priorityEl) priorityEl.value = task.priority || '';
    const notesEl = document.getElementById('f-notes');
    if (notesEl) notesEl.value = task.notes || '';

  } else if (type === 'hours') {
    prefillHoursModalValues(id);
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

      if (state.editTarget) {
        await updateDoc(projectDoc(cId, state.editTarget.id), {
          name, description: desc || null, status
        });
        toast('تم تعديل المشروع بنجاح! 🎉', 'success');
      } else {
        await addDoc(projectsRef(cId), { name, description: desc || null, status, createdAt: serverTimestamp() });
        toast('تمت إضافة المشروع! 🎉', 'success');
      }
      closeModal();

    } else if (currentModalType === 'task') {
      const title    = document.getElementById('f-title').value.trim();
      const priority = document.getElementById('f-priority')?.value || null;
      const notes    = document.getElementById('f-notes')?.value.trim() || null;
      if (!title) { toast('يرجى إدخال عنوان المهمة', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      if (state.editTarget) {
        await updateDoc(taskDoc(state.client.id, state.project.id, state.editTarget.id), {
          title, priority, notes
        });
        toast('تم تعديل المهمة بنجاح! 🎉', 'success');
      } else {
        await addDoc(tasksRef(state.client.id, state.project.id), {
          title, priority, notes, status: 'todo', createdAt: serverTimestamp()
        });
        toast('تمت إضافة المهمة! 🎉', 'success');
      }
      closeModal();

    } else if (currentModalType === 'hours') {
      const clientId  = document.getElementById('f-client-id')?.value;
      const projectId = document.getElementById('f-project-id')?.value;
      const hoursRaw  = document.getElementById('f-hours')?.value;
      const dateStr   = document.getElementById('f-date')?.value;
      const desc      = document.getElementById('f-description')?.value.trim() || null;
      const hours     = parseFloat(hoursRaw);

      if (!clientId)  { toast('يرجى اختيار العميل', 'error');   btn.disabled = false; btn.textContent = orig; return; }
      if (!projectId) { toast('يرجى اختيار المشروع', 'error'); btn.disabled = false; btn.textContent = orig; return; }
      if (!hours || hours <= 0 || hours > 24) {
        toast('يرجى إدخال عدد ساعات صحيح بين 0.25 و 24', 'error');
        btn.disabled = false; btn.textContent = orig; return;
      }
      if (!dateStr) { toast('يرجى تحديد التاريخ', 'error'); btn.disabled = false; btn.textContent = orig; return; }

      const logDate = new Date(dateStr + 'T12:00:00'); // noon to avoid TZ edge cases
      const minutes = Math.round(hours * 60);

      if (state.editTarget) {
        // Edit: adjust the diff on project.totalMinutesSpent
        const prev = state.timeLogs.find(l => l.id === state.editTarget.id);
        const prevMinutes = prev ? Math.round((prev.hours || 0) * 60) : 0;
        await updateDoc(timeLogDoc(state.editTarget.id), {
          clientId, projectId, hours, date: logDate, description: desc
        });
        if (prev && prev.projectId === projectId && prev.clientId === clientId) {
          // Same project — adjust the delta
          const delta = minutes - prevMinutes;
          if (delta !== 0) {
            try {
              await updateDoc(projectDoc(clientId, projectId), {
                totalMinutesSpent: increment(delta)
              });
            } catch (e) { console.warn('Project totalMinutesSpent update failed:', e); }
          }
        } else if (prev) {
          // Project changed — subtract from old, add to new
          try {
            await updateDoc(projectDoc(prev.clientId, prev.projectId), {
              totalMinutesSpent: increment(-prevMinutes)
            });
          } catch (e) { console.warn('Old project decrement failed:', e); }
          try {
            await updateDoc(projectDoc(clientId, projectId), {
              totalMinutesSpent: increment(minutes)
            });
          } catch (e) { console.warn('New project increment failed:', e); }
        }
        toast('تم تعديل السجل بنجاح! 🎉', 'success');
      } else {
        await addDoc(timeLogsRef(), {
          clientId, projectId, hours, date: logDate, description: desc,
          createdAt: serverTimestamp()
        });
        // Also bump the project's running total so badges stay in sync
        try {
          await updateDoc(projectDoc(clientId, projectId), {
            totalMinutesSpent: increment(minutes)
          });
        } catch (e) { console.warn('Project totalMinutesSpent update failed:', e); }
        toast(`تم تسجيل ${hours} ساعة بنجاح! ⏱️`, 'success');
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
  const titles = { client: 'حذف العميل', project: 'حذف المشروع', task: 'حذف المهمة', hours: 'حذف السجل' };
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

    } else if (target.type === 'hours') {
      // Reverse the project's totalMinutesSpent so it stays in sync
      const log = state.timeLogs.find(l => l.id === target.id);
      if (log && log.projectId && log.clientId) {
        const minutes = Math.round((Number(log.hours) || 0) * 60);
        if (minutes > 0) {
          try {
            await updateDoc(projectDoc(log.clientId, log.projectId), {
              totalMinutesSpent: increment(-minutes)
            });
          } catch (e) { console.warn('Project decrement failed:', e); }
        }
      }
      await deleteDoc(timeLogDoc(target.id));
      toast('تم حذف السجل', 'info', '🗑️');
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
    else if (state.view === 'hours')    openModal('hours');
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
//  HOURS TRACKER MODULE (v6.0)
// ════════════════════════════════════════════════════════════════

// ── Date format: "السبت 12 يونيو" ──
function formatHoursDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Round float hours to 2 decimals, drop trailing zeros
function formatHoursValue(h) {
  const n = Number(h) || 0;
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function subscribeHours() {
  // Subscribe to timeLogs + clients + projects (the latter two so we can show names)
  const logsQ = query(timeLogsRef(), orderBy('date', 'desc'));
  state.timeLogsUnsub = onSnapshot(logsQ, snap => {
    setOnline(); hideLoading();
    state.timeLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHours();
  }, err => { setOffline(); hideLoading(); console.error(err); toast('فشل الاتصال', 'error'); });

  // Clients (for names + total badge)
  const clientQ = query(clientsRef(), orderBy('createdAt', 'desc'));
  state.unsubscribe = onSnapshot(clientQ, snap => {
    setOnline(); hideLoading();
    state.clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const badge = document.getElementById('total-badge');
    if (badge) badge.textContent = state.clients.length;
    renderHours();
  }, err => { setOffline(); hideLoading(); console.error(err); });

  // Projects across all clients (for project names + the modal selector)
  const projQ = query(collectionGroup(db, 'projects'));
  state.dashUnsubProjects = onSnapshot(projQ, snap => {
    setOnline(); hideLoading();
    state.allProjects = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      _ref: d.ref,
      _clientId: d.ref.parent.parent.id
    }));
    renderHours();
  }, err => { setOffline(); hideLoading(); console.error(err); });
}

function renderHours() {
  if (state.view !== 'hours') return;

  // ── Summary calculations ──
  const now = new Date();
  // Week starts Saturday in Arab calendar — use 6 = Saturday
  const dayOfWeek = now.getDay(); // 0=Sun ... 6=Sat
  const daysSinceSat = (dayOfWeek + 1) % 7; // Sat=0, Sun=1, ..., Fri=6
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - daysSinceSat);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let weekHours = 0, monthHours = 0, totalHours = 0;
  state.timeLogs.forEach(log => {
    const h = Number(log.hours) || 0;
    totalHours += h;
    const d = log.date?.toDate ? log.date.toDate() : (log.date ? new Date(log.date) : null);
    if (!d) return;
    if (d >= startOfMonth) monthHours += h;
    if (d >= startOfWeek)  weekHours  += h;
  });

  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = formatHoursValue(val);
  };
  setStat('hours-week',  weekHours);
  setStat('hours-month', monthHours);
  setStat('hours-total', totalHours);

  // ── Logs grid ──
  const grid = document.getElementById('hours-logs-grid');
  if (!grid) return;

  const q = state.search.toLowerCase();
  const filtered = state.timeLogs.filter(log => {
    if (!q) return true;
    const client = state.clients.find(c => c.id === log.clientId);
    const project = state.allProjects.find(p => p.id === log.projectId);
    const haystack = [
      client?.name || '',
      project?.name || '',
      log.description || ''
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });

  if (filtered.length === 0) {
    grid.innerHTML = emptyStateHTML(
      '⏱️',
      state.search ? 'لا نتائج مطابقة' : 'لا توجد سجلات ساعات بعد',
      state.search ? 'جرّب كلمة بحث مختلفة' : 'اضغط "تسجيل ساعات جديدة" لإضافة أول سجل'
    );
    return;
  }

  grid.innerHTML = filtered.map(log => {
    const client  = state.clients.find(c => c.id === log.clientId);
    const project = state.allProjects.find(p => p.id === log.projectId);
    const clientName  = client  ? escapeHtml(client.name)  : 'عميل محذوف';
    const projectName = project ? escapeHtml(project.name) : 'مشروع محذوف';

    return `
      <div class="hours-log-card" data-id="${log.id}">
        <div class="hours-log-top">
          <div class="hours-log-meta">
            <span class="hours-log-client">👤 ${clientName}</span>
            <span class="hours-log-project" title="${projectName}">📁 ${projectName}</span>
          </div>
          <span class="hours-log-value">
            <span class="hours-log-value-num">${formatHoursValue(log.hours)}</span>
            <span class="hours-log-value-unit">س</span>
          </span>
        </div>
        ${log.description ? `<div class="hours-log-desc">${escapeHtml(log.description)}</div>` : ''}
        <div class="hours-log-footer">
          <span class="hours-log-date">📅 ${formatHoursDate(log.date)}</span>
          <div class="hours-log-actions">
            <button class="hours-log-edit" data-id="${log.id}" title="تعديل السجل">✏️</button>
            <button class="hours-log-del"  data-id="${log.id}" title="حذف السجل">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Bind delete/edit
  grid.querySelectorAll('.hours-log-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const log = state.timeLogs.find(l => l.id === btn.dataset.id);
      openConfirm({
        type: 'hours',
        id: btn.dataset.id,
        name: `${formatHoursValue(log?.hours || 0)} ساعة — ${formatHoursDate(log?.date)}`,
        warning: 'سيتم خصم هذه الساعات من إجمالي المشروع',
      });
    });
  });
  grid.querySelectorAll('.hours-log-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal('hours', btn.dataset.id);
    });
  });
}

// Prefill the hours modal when editing
function prefillHoursModalValues(id) {
  const log = state.timeLogs.find(l => l.id === id);
  if (!log) return;

  const clientSel  = document.getElementById('f-client-id');
  const projectSel = document.getElementById('f-project-id');
  const hoursEl    = document.getElementById('f-hours');
  const dateEl     = document.getElementById('f-date');
  const descEl     = document.getElementById('f-description');

  if (clientSel) {
    clientSel.value = log.clientId || '';
    // Trigger change to populate projects
    clientSel.dispatchEvent(new Event('change'));
  }
  if (projectSel) projectSel.value = log.projectId || '';
  if (hoursEl)    hoursEl.value = log.hours ?? '';
  if (dateEl && log.date) {
    const d = log.date.toDate ? log.date.toDate() : new Date(log.date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dateEl.value = `${yyyy}-${mm}-${dd}`;
  }
  if (descEl) descEl.value = log.description || '';
}

// ── Wire up Hours buttons (idempotent guard) ──
const btnAddHours = document.getElementById('btn-add-hours');
if (btnAddHours) {
  btnAddHours.addEventListener('click', () => openModal('hours'));
}

const searchHoursInput = document.getElementById('search-hours');
if (searchHoursInput) {
  searchHoursInput.addEventListener('input', e => {
    state.search = e.target.value;
    if (state.view === 'hours') renderHours();
  });
}

