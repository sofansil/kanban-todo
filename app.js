// ─── Supabase 설정 ────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://xawpgsvzyjvqcmhhcvhw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_e1V62Cn9wTbEZk6XuEMJYg_y4DqMcF_';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
// ──────────────────────────────────────────────────────────────────────────────

// ─── DOM 참조 — 앱 ────────────────────────────────────────────────────────────
const todoInput      = document.getElementById('todo-input');
const prioritySelect = document.getElementById('priority-select');
const addBtn         = document.getElementById('add-btn');
const board          = document.getElementById('board');

// ─── DOM 참조 — 인증 ──────────────────────────────────────────────────────────
const authOverlay   = document.getElementById('auth-overlay');
const authEmailEl   = document.getElementById('auth-email');
const authPassEl    = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('auth-submit');
const authMessageEl = document.getElementById('auth-message');
const userInfo        = document.getElementById('user-info');
const userEmailEl     = document.getElementById('user-email');
const userProviderEl  = document.getElementById('user-provider');
const logoutBtn       = document.getElementById('logout-btn');
// ──────────────────────────────────────────────────────────────────────────────

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: '높음', medium: '중간', low: '낮음' };

const COLS = {
  todo:        document.getElementById('col-todo'),
  in_progress: document.getElementById('col-in-progress'),
  done:        document.getElementById('col-done'),
};

const COUNTS = {
  todo:        document.getElementById('count-todo'),
  in_progress: document.getElementById('count-in-progress'),
  done:        document.getElementById('count-done'),
};

// 칸반 열 이동 맵
const PREV_STATUS = { in_progress: 'todo', done: 'in_progress' };
const NEXT_STATUS = { todo: 'in_progress', in_progress: 'done' };

let todos = [];
let editingId = null;
const processingIds = new Set();
let currentUserId = null;
let authMode = 'signin';

// ─── 토스트 ───────────────────────────────────────────────────────────────────
function showToast(message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast toast-error';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── 인증 ─────────────────────────────────────────────────────────────────────
function setAuthMessage(msg, isError = true) {
  authMessageEl.textContent = msg;
  authMessageEl.className = 'auth-message ' + (isError ? 'error' : 'success');
}

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.tab;
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    authSubmitBtn.textContent = authMode === 'signin' ? '로그인' : '회원가입';
    setAuthMessage('');
  });
});

authSubmitBtn.addEventListener('click', async () => {
  const email    = authEmailEl.value.trim();
  const password = authPassEl.value;
  if (!email || !password) { setAuthMessage('이메일과 비밀번호를 입력하세요.'); return; }

  authSubmitBtn.disabled = true;
  let error;
  if (authMode === 'signin') {
    ({ error } = await db.auth.signInWithPassword({ email, password }));
  } else {
    ({ error } = await db.auth.signUp({ email, password }));
  }
  authSubmitBtn.disabled = false;

  if (error) { setAuthMessage(error.message); return; }
  if (authMode === 'signup') {
    setAuthMessage('확인 이메일을 발송했습니다. 메일함을 확인하세요.', false);
  } else {
    sessionStorage.setItem('loginProvider', 'email');
  }
});

authPassEl.addEventListener('keydown', e => { if (e.key === 'Enter') authSubmitBtn.click(); });

document.getElementById('login-google').addEventListener('click', () => {
  sessionStorage.setItem('loginProvider', 'google');
  db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
});

document.getElementById('login-github').addEventListener('click', () => {
  sessionStorage.setItem('loginProvider', 'github');
  db.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: window.location.origin + window.location.pathname } });
});

logoutBtn.addEventListener('click', () => db.auth.signOut());

const PROVIDER_LABEL = { email: '이메일', google: 'Google', github: 'GitHub' };

function showApp(user) {
  currentUserId = user.id;
  userEmailEl.textContent = user.email ?? user.user_metadata?.full_name ?? '';
  const provider = sessionStorage.getItem('loginProvider') ?? user.app_metadata?.provider ?? 'email';
  userProviderEl.textContent = PROVIDER_LABEL[provider] ?? provider;
  userProviderEl.dataset.provider = provider;
  userInfo.style.display = 'flex';
  authOverlay.style.display = 'none';
  init();
}

function showAuth() {
  currentUserId = null;
  todos = [];
  sessionStorage.removeItem('loginProvider');
  userInfo.style.display = 'none';
  authOverlay.style.display = 'flex';
  Object.values(COLS).forEach(col => col.innerHTML = '');
  Object.values(COUNTS).forEach(c => c.textContent = '0');
}

db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    showAuth();
  } else if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
    showApp(session.user);
  }
});
// ──────────────────────────────────────────────────────────────────────────────

// ─── 데이터 로드 ──────────────────────────────────────────────────────────────
async function loadTodos() {
  const { data, error } = await db
    .from('todos')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    showToast('데이터를 불러오지 못했습니다.');
    return [];
  }
  return data;
}

async function init() {
  Object.values(COLS).forEach(col => {
    col.innerHTML = '<li class="loading-msg">불러오는 중…</li>';
  });
  todos = await loadTodos();
  sortByPriority();
}

// ─── 정렬 / 렌더링 ────────────────────────────────────────────────────────────
function sortByPriority() {
  todos.sort((a, b) =>
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    new Date(a.created_at) - new Date(b.created_at)
  );
  renderBoard();
}

function renderBoard() {
  Object.values(COLS).forEach(col => col.innerHTML = '');

  const groups = { todo: [], in_progress: [], done: [] };
  todos.forEach(t => {
    const s = t.status ?? 'todo';
    if (groups[s]) groups[s].push(t);
  });

  Object.entries(groups).forEach(([status, items]) => {
    COUNTS[status].textContent = items.length;

    if (items.length === 0) {
      const msg = document.createElement('li');
      msg.className = 'empty-msg';
      msg.textContent = '항목이 없습니다';
      COLS[status].appendChild(msg);
      return;
    }

    items.forEach(todo => {
      COLS[status].appendChild(createCard(todo, status));
    });
  });
}

function createCard(todo, status) {
  const li = document.createElement('li');
  li.className = 'card-item' + (status === 'done' ? ' done' : '');
  li.dataset.id = todo.id;
  li.dataset.status = status;
  li.dataset.priority = todo.priority;

  if (todo.id === editingId) {
    li.classList.add('editing');

    const editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'edit-input';
    editInput.value = todo.text;

    const editSelect = document.createElement('select');
    editSelect.className = 'edit-priority-select';
    ['high', 'medium', 'low'].forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = PRIORITY_LABEL[p];
      if (p === todo.priority) opt.selected = true;
      editSelect.appendChild(opt);
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = '✓';
    saveBtn.title = '저장';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-btn';
    cancelBtn.textContent = '✕';
    cancelBtn.title = '취소';

    editInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveEdit(todo.id);
      if (e.key === 'Escape') cancelEdit();
    });

    li.appendChild(editInput);
    li.appendChild(editSelect);
    li.appendChild(saveBtn);
    li.appendChild(cancelBtn);

    requestAnimationFrame(() => { editInput.focus(); editInput.select(); });
  } else {
    const top = document.createElement('div');
    top.className = 'card-top';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = (status === 'done');
    checkbox.disabled = processingIds.has(todo.id);
    checkbox.title = status === 'done' ? '완료 취소' : '완료로 이동';

    const badge = document.createElement('span');
    badge.className = `priority-badge ${todo.priority}`;
    badge.textContent = PRIORITY_LABEL[todo.priority];

    top.appendChild(checkbox);
    top.appendChild(badge);

    const text = document.createElement('span');
    text.className = 'card-text';
    text.textContent = todo.text;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (PREV_STATUS[status]) {
      const prevBtn = document.createElement('button');
      prevBtn.className = 'move-prev-btn';
      prevBtn.textContent = '←';
      prevBtn.title = '이전 단계로';
      actions.appendChild(prevBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = '수정';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = '삭제';

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    if (NEXT_STATUS[status]) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'move-next-btn';
      nextBtn.textContent = '→';
      nextBtn.title = '다음 단계로';
      actions.appendChild(nextBtn);
    }

    li.appendChild(top);
    li.appendChild(text);
    li.appendChild(actions);
  }

  return li;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
async function addTodo() {
  const text = todoInput.value.trim();
  if (!text || addBtn.disabled) return;

  addBtn.disabled = true;
  const priority = prioritySelect.value;
  const { data, error } = await db
    .from('todos')
    .insert({ text, priority, status: 'todo', user_id: currentUserId })
    .select()
    .single();
  addBtn.disabled = false;

  if (error) {
    showToast('추가에 실패했습니다.');
    return;
  }

  todos.push(data);
  sortByPriority();
  todoInput.value = '';
  todoInput.focus();
}

async function moveCard(id, newStatus) {
  if (processingIds.has(id)) return;

  processingIds.add(id);
  const { error } = await db
    .from('todos')
    .update({ status: newStatus })
    .eq('id', id);
  processingIds.delete(id);

  if (error) {
    showToast('이동에 실패했습니다.');
    return;
  }

  todos = todos.map(t => t.id === id ? { ...t, status: newStatus } : t);
  renderBoard();
}

async function deleteTodo(id) {
  if (processingIds.has(id)) return;

  processingIds.add(id);
  const { error } = await db
    .from('todos')
    .delete()
    .eq('id', id);
  processingIds.delete(id);

  if (error) {
    showToast('삭제에 실패했습니다.');
    return;
  }

  todos = todos.filter(t => t.id !== id);
  renderBoard();
}

function enterEditMode(id) {
  editingId = id;
  renderBoard();
}

async function saveEdit(id) {
  const card = document.querySelector(`.card-item[data-id="${id}"]`);
  if (!card) return;
  const editInput  = card.querySelector('.edit-input');
  const editSelect = card.querySelector('.edit-priority-select');
  const saveBtn    = card.querySelector('.save-btn');
  const text = editInput.value.trim();
  if (!text || saveBtn.disabled) return;

  saveBtn.disabled = true;
  const priority = editSelect.value;
  const { error } = await db
    .from('todos')
    .update({ text, priority })
    .eq('id', id);

  if (error) {
    showToast('수정에 실패했습니다.');
    saveBtn.disabled = false;
    return;
  }

  todos = todos.map(t => t.id === id ? { ...t, text, priority } : t);
  editingId = null;
  sortByPriority();
}

function cancelEdit() {
  editingId = null;
  renderBoard();
}

// ─── 이벤트 ───────────────────────────────────────────────────────────────────
addBtn.addEventListener('click', addTodo);

todoInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') addTodo();
});

board.addEventListener('click', e => {
  const card = e.target.closest('.card-item');
  if (!card) return;
  const id     = Number(card.dataset.id);
  const status = card.dataset.status;

  if (e.target.type === 'checkbox') {
    if (processingIds.has(id)) { e.preventDefault(); return; }
    moveCard(id, e.target.checked ? 'done' : (PREV_STATUS[status] ?? 'todo'));
  } else if (e.target.classList.contains('move-prev-btn')) {
    moveCard(id, PREV_STATUS[status]);
  } else if (e.target.classList.contains('move-next-btn')) {
    moveCard(id, NEXT_STATUS[status]);
  } else if (e.target.classList.contains('edit-btn')) {
    enterEditMode(id);
  } else if (e.target.classList.contains('save-btn')) {
    saveEdit(id);
  } else if (e.target.classList.contains('cancel-btn')) {
    cancelEdit();
  } else if (e.target.classList.contains('delete-btn')) {
    deleteTodo(id);
  }
});
