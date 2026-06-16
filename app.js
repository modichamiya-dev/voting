const ELECTION_SCOPE = 'cabinet';

const ROLES = [
  { id: 'head_boy',                label: 'Head Boy',                gender: 'boy',  icon: 'HB' },
  { id: 'head_girl',               label: 'Head Girl',               gender: 'girl', icon: 'HG' },
  { id: 'assistant_head_boy',      label: 'Assistant Head Boy',      gender: 'boy',  icon: 'AB' },
  { id: 'assistant_head_girl',     label: 'Assistant Head Girl',     gender: 'girl', icon: 'AG' },
  { id: 'sports_captain_boy',      label: 'Sports Captain Boy',      gender: 'boy',  icon: 'SB' },
  { id: 'sports_captain_girl',     label: 'Sports Captain Girl',     gender: 'girl', icon: 'SG' },
  { id: 'vice_sports_captain_boy', label: 'Vice Sports Captain Boy', gender: 'boy',  icon: 'VB' },
  { id: 'vice_sports_captain_girl',label: 'Vice Sports Captain Girl',gender: 'girl', icon: 'VG' },
  { id: 'cultural_secretary_boy',  label: 'Cultural Secretary Boy',  gender: 'boy',  icon: 'CB' },
  { id: 'cultural_secretary_girl', label: 'Cultural Secretary Girl', gender: 'girl', icon: 'CG' },
];

// ─── STATE ────────────────────────────────────────────────
let state = {
  page: 'home',        // home | vote | success | results | admin | login
  voterName: '',
  voterSection: '',
  voterRoleNo: '',
  votes: {},           // { roleId: candidateId }
  adminLoggedIn: !!sessionStorage.getItem('hce_token'),
  adminToken: sessionStorage.getItem('hce_token') || '',
  adminPath: localStorage.getItem('hce_admin_path') || '/admin-portal-2026',
  adminActiveView: 'add', // add | list | results | audit | danger
  candidates: {},
  voteLedger: {},
  integrity: null,
  auditLog: null,
  currentVoterId: null,
};

// ─── API INTERFACE ────────────────────────────────────────
async function apiCall(url, method = 'GET', body = null, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.adminToken) {
    headers['Authorization'] = `Bearer ${state.adminToken}`;
  }
  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
    throw err;
  }
}

async function fetchCandidates() {
  try {
    const data = await apiCall('/api/candidates');
    state.candidates = data;
    render();
  } catch (err) {}
}

async function fetchResults() {
  try {
    const data = await apiCall('/api/admin/results', 'GET', null, true);
    state.voteLedger = data.votes;
    state.candidates = data.candidates;
    state.integrity = data.integrity || null;
    render();
  } catch (err) {
    if (err.message === 'Unauthorized') {
      // Stale token — clear it and show login page (don't redirect home)
      state.adminLoggedIn = false;
      state.adminToken = '';
      sessionStorage.removeItem('hce_token');
      state.page = 'login';
      render();
    }
  }
}

async function fetchAuditLog() {
  try {
    const data = await apiCall('/api/admin/audit', 'GET', null, true);
    state.auditLog = data;
    render();
  } catch (err) {}
}

// ─── RENDER ───────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  app.innerHTML = buildLayout();
  attachEvents();
}

function buildLayout() {
  const showNav = state.adminLoggedIn || ['admin', 'login'].includes(state.page);
  return `
    ${showNav ? buildNav() : ''}
    <main class="main" style="${showNav ? '' : 'padding-top: 24px; min-height: 100vh;'}">
      <div class="page ${state.page === 'home' ? 'active' : ''}" id="page-home">${buildHome()}</div>
      <div class="page ${state.page === 'vote' ? 'active' : ''}" id="page-vote">${buildVote()}</div>
      <div class="page ${state.page === 'success' ? 'active' : ''}" id="page-success">${buildSuccess()}</div>
      <div class="page ${state.page === 'results' ? 'active' : ''}" id="page-results">${buildResults()}</div>
      <div class="page ${['admin','login'].includes(state.page) ? 'active' : ''}" id="page-admin">
        ${state.page === 'login' ? buildLogin() : buildAdmin()}
      </div>
    </main>
    ${buildConfirmModal()}
    ${buildToast()}
  `;
}

function buildNav() {
  return `
  <nav class="nav">
    <div class="nav-brand" onclick="goHome()">
      <div class="nav-brand-dot"></div>
      Elections
    </div>
    <div class="nav-tabs">
      <button class="nav-tab ${state.page === 'home' || state.page === 'vote' ? 'active' : ''}" onclick="goHome()">Vote</button>
      ${state.adminLoggedIn ? `<button class="nav-tab ${state.page === 'results' ? 'active' : ''}" onclick="goPage('results')">Live Results</button>` : ''}
    </div>
    <div class="nav-right">
      <button class="nav-admin-btn" onclick="goAdmin()">
        ${state.adminLoggedIn ? '⚙️ Admin Dashboard' : '🔐 Admin Sign In'}
      </button>
    </div>
  </nav>`;
}

// ─── HOME PAGE ────────────────────────────────────────────
function buildHome() {
  return `
  <section class="hero" style="padding-top: 40px; padding-bottom: 20px;">
    <h1 class="hero-title">Voter Registration</h1>
    <p class="hero-subtitle">Enter your student details to begin voting.</p>
  </section>
  <div class="registration-container">
    <div class="registration-card">
      <div class="form-group-premium">
        <label class="form-label-premium">Name</label>
        <input class="form-input-premium" id="voter-name-input" placeholder="Your full name" />
      </div>
      <div class="form-group-premium">
        <label class="form-label-premium">Class & Section</label>
        <input class="form-input-premium" id="voter-section-input" placeholder="e.g. 10-A, 12-B" />
      </div>
      <div class="form-group-premium">
        <label class="form-label-premium">Roll Number</label>
        <input class="form-input-premium" id="voter-roleno-input" placeholder="e.g. 25" />
      </div>
      
      <div id="voter-error" class="voter-error-message" style="display:none"></div>
      <button class="btn-primary-premium" onclick="proceedToVote()">Continue to Vote</button>
    </div>
  </div>`;
}

async function proceedToVote() {
  const name = document.getElementById('voter-name-input').value.trim();
  const section = document.getElementById('voter-section-input').value.trim();
  const roleNo = document.getElementById('voter-roleno-input').value.trim();
  const errEl = document.getElementById('voter-error');

  if (!name || !section || !roleNo) {
    errEl.textContent = 'Please fill in all fields.';
    errEl.style.display = 'block';
    return;
  }

  const voterId = `${ELECTION_SCOPE}_${roleNo}`;
  const submitBtn = document.querySelector('.btn-primary-premium');
  
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying details...';
  }

  try {
    const check = await apiCall(`/api/check-voted?voterId=${encodeURIComponent(voterId)}`);
    if (check.voted) {
      errEl.textContent = 'This Roll No. has already voted.';
      errEl.style.display = 'block';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue to Vote';
      }
      return;
    }
  } catch (err) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue to Vote';
    }
    return;
  }

  state.voterName = name;
  state.voterSection = section;
  state.voterRoleNo = roleNo;
  state.currentVoterId = voterId;
  state.votes = {};
  state.page = 'vote';
  render();
}

// ─── VOTE PAGE ────────────────────────────────────────────
function buildVote() {
  const cabinetCandidates = Object.values(state.candidates);

  return `
  <div class="vote-page">
    <div class="vote-header">
      <button class="vote-back-btn" onclick="goHome()">← Cancel</button>
      <h1 class="vote-page-title">Cabinet Election</h1>
    </div>
    <p class="vote-subtitle">Select one candidate for each cabinet category. You cannot change your vote after submission.</p>

    <div class="voter-info-bar">
      <div class="voter-info-item">
        <span class="voter-info-label">Voter:</span>
        <span class="voter-info-val">${esc(state.voterName)}</span>
      </div>
      <div class="voter-info-item" style="margin-left:auto">
        <span class="voter-info-label">Section:</span>
        <span class="voter-info-badge">${esc(state.voterSection)}</span>
      </div>
      <div class="voter-info-item">
        <span class="voter-info-label">Roll No:</span>
        <span class="voter-info-val">${esc(state.voterRoleNo)}</span>
      </div>
    </div>

    ${ROLES.map(role => {
      const roleCandidates = cabinetCandidates.filter(c => c.role === role.id);
      return `
      <div class="vote-category">
        <div class="vote-category-header">
          <div class="vote-category-left">
            <div class="vote-category-icon">${role.icon}</div>
            <div class="vote-category-title">${role.label}</div>
          </div>
          <div class="vote-category-note">Select 1 candidate</div>
        </div>
        ${roleCandidates.length === 0
          ? `<div class="empty-state"><div class="empty-state-icon">👤</div>No nominees added yet for this category</div>`
          : `<div class="candidates-grid">
              ${roleCandidates.map(c => `
              <div class="candidate-card ${state.votes[role.id] === c.id ? 'selected' : ''}"
                   onclick="castVote('${role.id}','${c.id}')">
                <div class="candidate-check">✓</div>
                ${c.photo
                  ? `<div class="candidate-photo"><img src="${c.photo}" alt="${esc(c.name)}" /></div>`
                  : `<div class="candidate-photo-placeholder">${genderEmoji(role.gender)}</div>`
                }
                <div class="candidate-name">${esc(c.name)}</div>
              </div>`).join('')}
            </div>`}
      </div>`;
    }).join('')}

    <div class="vote-submit-area">
      <div class="vote-summary">
        ${ROLES.map(role => {
          const filled = !!state.votes[role.id];
          const candidate = filled ? state.candidates[state.votes[role.id]] : null;
          return `
          <div class="vote-summary-chip ${filled ? 'filled' : ''}">
            <div class="chip-dot" style="background:${filled ? 'var(--accent-color)' : 'var(--text-muted)'}"></div>
            ${role.label}: ${filled ? `<strong>${esc(candidate?.name || '')}</strong>` : 'Not selected'}
          </div>`;
        }).join('')}
      </div>
      <button class="btn-primary"
        ${allVotesCast() ? '' : 'disabled'}
        onclick="showConfirmModal()">
        ${allVotesCast() ? 'Submit My Votes' : `Select ${remainingCount()} more to continue`}
      </button>
      <div class="vote-note">Votes are final and cannot be changed after submission</div>
    </div>
  </div>`;
}

function castVote(roleId, candidateId) {
  if (state.votes[roleId] === candidateId) {
    delete state.votes[roleId];
  } else {
    state.votes[roleId] = candidateId;
  }
  const page = document.getElementById('page-vote');
  if (page) page.innerHTML = buildVote();
}

function allVotesCast() {
  return ROLES.every(r => !!state.votes[r.id]);
}
function remainingCount() {
  return ROLES.filter(r => !state.votes[r.id]).length;
}

// ─── CONFIRM & SUBMIT ─────────────────────────────────────
function showConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) {
    // Dynamically populate items in modal content
    const body = modal.querySelector('.modal-body');
    body.innerHTML = `
      You are voting as <strong>${esc(state.voterName)}</strong> in the
      <strong>Cabinet Election</strong>.<br>
      This action cannot be undone.
      <div style="margin-top:16px;text-align:left;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;font-size:13px;display:flex;flex-direction:column;gap:8px">
        ${ROLES.map(role => {
          const c = state.votes[role.id] ? state.candidates[state.votes[role.id]] : null;
          return c ? `<div style="color:var(--text-secondary)">${role.label}: <strong style="color:var(--text-primary)">${esc(c.name)}</strong></div>` : '';
        }).join('')}
      </div>
    `;
    modal.classList.add('open');
  }
}
function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.remove('open');
}

async function submitVotes() {
  closeConfirmModal();
  try {
    await apiCall('/api/vote', 'POST', {
      voterName: state.voterName,
      section: state.voterSection,
      roleNo: state.voterRoleNo,
      house: ELECTION_SCOPE,
      votes: state.votes
    });
    state.page = 'success';
    render();
  } catch (err) {
    // Error is handled & toasted by apiCall
    goHome();
  }
}

function buildConfirmModal() {
  return `
  <div class="modal-overlay" id="confirm-modal">
    <div class="modal">
      <div class="modal-icon">🗳️</div>
      <div class="modal-title">Confirm Your Vote</div>
      <div class="modal-body"></div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeConfirmModal()">Go Back</button>
        <button class="btn-primary" onclick="submitVotes()">Confirm Vote</button>
      </div>
    </div>
  </div>`;
}

// ─── SUCCESS PAGE ─────────────────────────────────────────
function buildSuccess() {
  return `
  <div class="success-page">
    <div class="success-glow">✅</div>
    <h2 class="success-title">Vote Submitted!</h2>
    <p class="success-body">Thank you, <strong>${esc(state.voterName)}</strong>. Your vote has been recorded securely. Results will be announced after the election closes.</p>
    <button class="btn-primary" onclick="goHome()">Return Home</button>
  </div>`;
}

// ─── RESULTS PAGE ─────────────────────────────────────────
function buildResultsInner() {
  const tallies = computeTallies();
  const totalVoters = Object.keys(state.voteLedger).length;

  return `
  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-label">Total Votes Cast</div>
      <div class="stat-value">${totalVoters}</div>
      <div class="stat-sub">cabinet ballots</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Categories</div>
      <div class="stat-value">${ROLES.length}</div>
      <div class="stat-sub">cabinet posts</div>
    </div>
  </div>

  <div class="results-grid" id="results-grid">
    ${buildResultCards(tallies)}
  </div>`;
}

function buildResults() {
  return `
  <div class="dashboard-page">
    <h1 class="dashboard-title">Live Results</h1>
    <p class="dashboard-sub">Updated in real time as votes are cast</p>
    ${buildResultsInner()}
  </div>`;
}

function buildResultCards(tallies) {
  return ROLES.map(role => {
    const entries = tallies[role.id] || [];
    const maxVotes = Math.max(1, ...entries.map(e => e.votes));
    return `
      <div class="result-card">
        <div class="result-card-header">
          <div class="result-house-badge"></div>
          <span class="result-house-label">Cabinet</span>
          <span class="result-role-tag">${role.label}</span>
        </div>
        <div class="result-entries">
          ${entries.length === 0
            ? `<div class="empty-state" style="padding:20px 0"><div class="empty-state-icon">—</div><span>No nominees</span></div>`
            : entries.map((entry, i) => {
                const pct = (entry.votes / maxVotes) * 100;
                return `
                <div class="result-entry ${i === 0 && entry.votes > 0 ? 'leader' : ''}">
                  <div class="result-bar" style="width:${pct}%"></div>
                  ${i === 0 && entry.votes > 0 ? `<div class="leader-crown">👑 LEADING</div>` : ''}
                  <div class="result-avatar-sm">
                    ${entry.photo
                      ? `<img src="${entry.photo}" alt="${esc(entry.name)}" />`
                      : genderEmoji(role.gender)}
                  </div>
                  <div class="result-info">
                    <div class="result-name">${esc(entry.name)}</div>
                  </div>
                  <div class="result-votes">${entry.votes}</div>
                </div>`;
              }).join('')}
        </div>
      </div>`;
  }).join('');
}

function computeTallies() {
  const tallies = {};
  ROLES.forEach(r => {
    tallies[r.id] = Object.values(state.candidates)
      .filter(c => c.role === r.id)
      .map(c => ({ ...c, votes: 0 }));
  });
  Object.values(state.voteLedger).forEach(ledgerEntry => {
    Object.entries(ledgerEntry.votes || {}).forEach(([roleId, candidateId]) => {
      const candidate = state.candidates[candidateId];
      if (!candidate) return;
      const arr = tallies[roleId];
      if (arr) {
        const entry = arr.find(e => e.id === candidateId);
        if (entry) entry.votes++;
      }
    });
  });
  Object.keys(tallies).forEach(role => {
    tallies[role].sort((a, b) => b.votes - a.votes);
  });
  return tallies;
}

// ─── ADMIN ────────────────────────────────────────────────
function buildLogin() {
  return `
  <div class="admin-login">
    <div class="login-card">
      <div class="login-icon"></div>
      <div class="login-title">Admin Panel</div>
      <div class="login-sub"></div>
      <div class="form-group" style="margin-bottom:18px">
        <label class="form-label">Password</label>
        <input class="form-input" type="password" id="admin-pw" placeholder="Enter password"
          onkeydown="if(event.key==='Enter')attemptLogin()" />
      </div>
      <button class="btn-primary" style="width:100%" onclick="attemptLogin()">Sign In</button>
      <div class="login-error" id="login-error">Incorrect password. Please try again.</div>
    </div>
  </div>`;
}

async function attemptLogin() {
  const pw = document.getElementById('admin-pw').value;
  try {
    const res = await apiCall('/api/admin/login', 'POST', { password: pw });
    state.adminLoggedIn = true;
    state.adminToken = res.token;
    state.adminPath = res.adminPath;
    sessionStorage.setItem('hce_token', res.token);
    localStorage.setItem('hce_admin_path', res.adminPath);
    
    state.page = 'admin';
    state.adminActiveView = 'add';
    if (window.location.pathname !== state.adminPath) {
      window.history.pushState({}, '', state.adminPath);
    }
    fetchResults();
  } catch (err) {
    const errEl = document.getElementById('login-error');
    if (errEl) {
      errEl.textContent = err.message || 'Incorrect password.';
      errEl.style.display = 'block';
    }
  }
}

function buildAdmin() {
  if (!state.adminLoggedIn) return buildLogin();
  return `
  <div class="admin-container">
    <aside class="admin-sidebar">
      <div class="admin-sidebar-header">
        Elections Dashboard
      </div>
      <button class="sidebar-btn ${state.adminActiveView === 'add' ? 'active' : ''}" onclick="setAdminView('add')">
        <span class="btn-icon">＋</span> Add Nominee
      </button>
      <button class="sidebar-btn ${state.adminActiveView === 'list' ? 'active' : ''}" onclick="setAdminView('list')">
        <span class="btn-icon">👥</span> Nominees List
      </button>
      <button class="sidebar-btn ${state.adminActiveView === 'results' ? 'active' : ''}" onclick="setAdminView('results')">
        <span class="btn-icon">📊</span> View Results
      </button>
      <button class="sidebar-btn ${state.adminActiveView === 'audit' ? 'active' : ''}" onclick="setAdminView('audit')">
        <span class="btn-icon">#</span> Audit Log
      </button>
      <button class="sidebar-btn ${state.adminActiveView === 'danger' ? 'active' : ''}" onclick="setAdminView('danger')">
        <span class="btn-icon">⚠️</span> Danger Zone
      </button>
      
      <div class="sidebar-footer">
        <button class="btn-sidebar-logout" onclick="adminLogout()">Sign Out</button>
      </div>
    </aside>

    <main class="admin-main">
      ${buildAdminContent()}
    </main>
  </div>`;
}

function setAdminView(view) {
  state.adminActiveView = view;
  if (['list', 'results'].includes(view)) {
    fetchResults();
  } else if (view === 'audit') {
    fetchAuditLog();
  } else {
    render();
  }
}

function buildAdminContent() {
  const nominees = Object.values(state.candidates);

  if (state.adminActiveView === 'add') {
    return `
    <div class="admin-card">
      <div class="admin-card-title">Add Nominee</div>
      <div class="admin-card-desc">Register a candidate for a cabinet category.</div>

      <div class="nominee-form-grid">
        <div class="nominee-photo-side">
          <label class="form-label" style="align-self: flex-start; margin-bottom: 2px;">Passport Photo</label>
          <div class="passport-uploader" onclick="document.getElementById('c-photo-input').click()">
            <input type="file" id="c-photo-input" accept="image/*" onchange="handlePhotoSelect(event)" />
            ${pendingPhotoData
              ? `<img src="${pendingPhotoData}" class="passport-preview-img" alt="Preview Photo" />`
              : `<div class="passport-uploader-icon">📷</div>
                 <div class="passport-uploader-text"><span>Click</span> to upload Portrait photo</div>`
            }
          </div>
          ${pendingPhotoData
            ? `<button class="btn-secondary" style="font-size: 11px; padding: 4px 12px; margin-top: 4px;" onclick="removePendingPhoto(event)">Clear photo</button>`
            : ''
          }
        </div>

        <div class="nominee-info-side">
          <div class="nominee-form-row">
            <div class="form-group" style="grid-column: span 2;">
              <label class="form-label">Full Name</label>
              <input class="form-input" id="c-name" placeholder="Nominee's full name" />
            </div>
          </div>

          <div class="nominee-form-row">
            <div class="form-group">
              <label class="form-label">Role</label>
              <select class="form-select" id="c-role">
                ${ROLES.map(r => `<option value="${r.id}">${r.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="margin-top: 12px;">
            <button class="btn-primary" onclick="addCandidate()">＋ Save Nominee</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  if (state.adminActiveView === 'list') {
    return `
    <div class="admin-card">
      <div class="admin-list-header">
        <div>
          <div class="admin-card-title">Nominees Directory</div>
          <div class="admin-card-desc">Review all cabinet nominees by category.</div>
        </div>
        <div class="nominee-transfer-actions">
          <button class="btn-secondary compact-action" onclick="exportNominees()">Export JSON</button>
          <button class="btn-primary compact-action" onclick="openNomineeImport()">Import JSON</button>
          <input type="file" id="nominee-import-input" accept="application/json,.json" onchange="importNominees(event)" hidden />
        </div>
      </div>

      ${nominees.length === 0
        ? `<div class="empty-state"><div class="empty-state-icon">👤</div>No nominees added yet.</div>`
        : `<div class="admin-nominee-grid">
            ${nominees.map((c, index) => {
              const role = ROLES.find(r => r.id === c.role);
              return `
              <div class="admin-nominee-card" style="--delay:${Math.min(index * 45, 450)}ms">
                <div class="admin-nominee-photo">
                  ${c.photo ? `<img src="${c.photo}" alt="${esc(c.name)}" />` : genderEmoji(role?.gender || 'boy')}
                </div>
                <div class="admin-nominee-details">
                  <div class="admin-nominee-name">${esc(c.name)}</div>
                  <div class="admin-nominee-meta">${esc(role?.label || '')}</div>
                  <div class="admin-nominee-role">${cap(role?.gender||'')}</div>
                </div>
                <button class="admin-nominee-delete" onclick="deleteCandidate('${c.id}')">✕</button>
              </div>`;
            }).join('')}
          </div>`}
    </div>`;
  }

  if (state.adminActiveView === 'results') {
    return `
    <div class="admin-card">
      <div class="admin-card-title">Elections Results Ledger</div>
      <div class="admin-card-desc" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
        <span>View live results counters direct from Voting.</span>
        <div style="display: flex; gap: 10px;">
          <button class="btn-primary" style="padding: 8px 16px; font-size: 13px;" onclick="exportToCSV()">Export Excel (CSV)</button>
          <button class="btn-secondary" style="padding: 8px 16px; font-size: 13px;" onclick="exportToPDF()">Export PDF</button>
        </div>
      </div>
      ${buildIntegrityPanel(state.integrity)}
      ${buildResultsInner()}
    </div>`;
  }

  if (state.adminActiveView === 'audit') {
    return buildAuditLog();
  }

  if (state.adminActiveView === 'danger') {
    return `
    <div class="admin-card">
      <div class="admin-card-title" style="color:var(--house-red)">Danger Zone</div>
      <div class="admin-card-desc">Destructive configurations and data flush tools.</div>

      <div class="danger-section-card">
        <div class="danger-info">
          <div class="danger-title">Flush Voter Responses</div>
          <div class="danger-desc">Clears all votes while leaving candidate nominees registry intact.</div>
        </div>
        <button class="btn-danger" onclick="resetVotes()">Reset Votes</button>
      </div>

      <div class="danger-section-card">
        <div class="danger-info">
          <div class="danger-title">Flush Nominee and Voting Records</div>
          <div class="danger-desc">Factory reset database, clearing all nominees and votes history.</div>
        </div>
        <button class="btn-danger" onclick="resetAll()">Reset System</button>
      </div>
    </div>`;
  }
}

function buildIntegrityPanel(integrity) {
  if (!integrity) {
    return `
    <div class="integrity-panel pending">
      <div class="integrity-status-dot"></div>
      <div>
        <div class="integrity-title">Integrity not loaded</div>
        <div class="integrity-sub">Refresh results to verify the audit chain.</div>
      </div>
    </div>`;
  }

  const ok = integrity.auditValid && integrity.resultsValid;
  return `
  <div class="integrity-panel ${ok ? 'ok' : 'bad'}">
    <div class="integrity-status-dot"></div>
    <div class="integrity-copy">
      <div class="integrity-title">${ok ? 'Results verified' : 'Integrity warning'}</div>
      <div class="integrity-sub">${esc(integrity.message || '')}</div>
    </div>
    <div class="integrity-hashes">
      <div><span>Entries</span><strong>${integrity.auditEntryCount || 0}</strong></div>
      <div><span>Result hash</span><code>${shortHash(integrity.currentResultsHash)}</code></div>
      <div><span>Audit hash</span><code>${shortHash(integrity.lastAuditHash)}</code></div>
    </div>
  </div>`;
}

function buildAuditLog() {
  const audit = state.auditLog;
  if (!audit) {
    return `
    <div class="admin-card">
      <div class="admin-card-title">Audit Log</div>
      <div class="admin-card-desc">Loading audit chain verification...</div>
    </div>`;
  }

  const ok = audit.valid && audit.resultsValid;
  const entries = [...(audit.entries || [])].reverse();
  return `
  <div class="admin-card">
    <div class="admin-card-title">Audit Log</div>
    <div class="admin-card-desc" style="margin-bottom: 20px;">Hash-chained record of votes, admin access, nominee changes, and resets.</div>
    ${buildIntegrityPanel({
      auditValid: audit.valid,
      resultsValid: audit.resultsValid,
      message: audit.message,
      auditEntryCount: audit.entryCount,
      currentResultsHash: audit.currentResultsHash,
      lastAuditHash: audit.lastHash
    })}
    <div class="audit-toolbar">
      <button class="btn-secondary" onclick="fetchAuditLog()">Verify Again</button>
      <div class="audit-toolbar-status ${ok ? 'ok' : 'bad'}">${ok ? 'Chain intact' : 'Review required'}</div>
    </div>
    ${entries.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">#</div>No audit events recorded yet.</div>`
      : `<div class="audit-list">
          ${entries.map(entry => `
          <div class="audit-entry">
            <div class="audit-entry-main">
              <div class="audit-entry-title">${esc(formatAuditAction(entry.action))}</div>
              <div class="audit-entry-sub">${esc(formatAuditDetails(entry))}</div>
            </div>
            <div class="audit-entry-meta">
              <span>#${entry.index}</span>
              <code>${shortHash(entry.hash)}</code>
              <span>${esc(formatDateTime(entry.timestamp))}</span>
            </div>
          </div>`).join('')}
        </div>`}
  </div>`;
}

let pendingPhotoData = null;
let cropState = {
  active: false,
  img: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
};

function handlePhotoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      cropState.img = img;
      cropState.rawSrc = e.target.result;
      cropState.scale = 1;
      cropState.offsetX = 0;
      cropState.offsetY = 0;
      openCropModal();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  // Reset file input so re-selecting same file works
  event.target.value = '';
}

function openCropModal() {
  cropState.active = true;
  // Inject modal into DOM
  let modal = document.getElementById('crop-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'crop-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="crop-overlay" onclick="closeCropModal()"></div>
    <div class="crop-dialog">
      <div class="crop-header">
        <span class="crop-title">Adjust Photo</span>
        <button class="crop-close-btn" onclick="closeCropModal()">✕</button>
      </div>
      <div class="crop-canvas-area">
        <canvas id="crop-canvas" width="280" height="280"></canvas>
        <div class="crop-circle-mask"></div>
      </div>
      <div class="crop-zoom-row">
        <span class="crop-zoom-icon">🔍−</span>
        <input type="range" id="crop-zoom" class="crop-zoom-slider" min="50" max="300" value="100" oninput="onCropZoom(this.value)" />
        <span class="crop-zoom-icon">🔍+</span>
      </div>
      <div class="crop-actions">
        <button class="btn-secondary" onclick="closeCropModal()">Cancel</button>
        <button class="btn-secondary" onclick="useOriginalPhoto()">Use Original</button>
        <button class="btn-primary" onclick="applyCrop()">Apply</button>
      </div>
    </div>
  `;
  modal.classList.add('open');
  drawCropCanvas();
  // Attach drag events
  const canvas = document.getElementById('crop-canvas');
  canvas.addEventListener('mousedown', cropDragStart);
  canvas.addEventListener('mousemove', cropDragMove);
  canvas.addEventListener('mouseup', cropDragEnd);
  canvas.addEventListener('mouseleave', cropDragEnd);
  canvas.addEventListener('touchstart', cropTouchStart, { passive: false });
  canvas.addEventListener('touchmove', cropTouchMove, { passive: false });
  canvas.addEventListener('touchend', cropDragEnd);
  // Mouse wheel zoom
  canvas.addEventListener('wheel', cropWheel, { passive: false });
}

function useOriginalPhoto() {
  pendingPhotoData = cropState.rawSrc;
  closeCropModal();
  render();
}

function closeCropModal() {
  cropState.active = false;
  const modal = document.getElementById('crop-modal');
  if (modal) modal.classList.remove('open');
}

function onCropZoom(val) {
  cropState.scale = val / 100;
  drawCropCanvas();
}

function cropDragStart(e) {
  cropState.dragging = true;
  cropState.dragStartX = e.clientX;
  cropState.dragStartY = e.clientY;
  cropState.startOffsetX = cropState.offsetX;
  cropState.startOffsetY = cropState.offsetY;
}
function cropDragMove(e) {
  if (!cropState.dragging) return;
  cropState.offsetX = cropState.startOffsetX + (e.clientX - cropState.dragStartX);
  cropState.offsetY = cropState.startOffsetY + (e.clientY - cropState.dragStartY);
  drawCropCanvas();
}
function cropDragEnd() {
  cropState.dragging = false;
}
function cropTouchStart(e) {
  e.preventDefault();
  const t = e.touches[0];
  cropState.dragging = true;
  cropState.dragStartX = t.clientX;
  cropState.dragStartY = t.clientY;
  cropState.startOffsetX = cropState.offsetX;
  cropState.startOffsetY = cropState.offsetY;
}
function cropTouchMove(e) {
  e.preventDefault();
  if (!cropState.dragging) return;
  const t = e.touches[0];
  cropState.offsetX = cropState.startOffsetX + (t.clientX - cropState.dragStartX);
  cropState.offsetY = cropState.startOffsetY + (t.clientY - cropState.dragStartY);
  drawCropCanvas();
}
function cropWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.05 : 0.05;
  cropState.scale = Math.max(0.5, Math.min(3, cropState.scale + delta));
  const slider = document.getElementById('crop-zoom');
  if (slider) slider.value = Math.round(cropState.scale * 100);
  drawCropCanvas();
}

function drawCropCanvas() {
  const canvas = document.getElementById('crop-canvas');
  if (!canvas || !cropState.img) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Draw image centered + scaled + offset
  const img = cropState.img;
  const scale = cropState.scale;
  const imgW = img.width * scale;
  const imgH = img.height * scale;
  const drawX = (w - imgW) / 2 + cropState.offsetX;
  const drawY = (h - imgH) / 2 + cropState.offsetY;

  ctx.drawImage(img, drawX, drawY, imgW, imgH);

  // Draw dark overlay with circular cutout
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Draw circle border
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 120, 0, Math.PI * 2);
  ctx.stroke();
}

function applyCrop() {
  // Export the circular crop area as a data URL
  const size = 240;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = size;
  exportCanvas.height = size;
  const ctx = exportCanvas.getContext('2d');

  // Draw the image in the same position as preview
  const img = cropState.img;
  const scale = cropState.scale;
  const srcW = 280, srcH = 280;
  const imgW = img.width * scale;
  const imgH = img.height * scale;
  const drawX = (srcW - imgW) / 2 + cropState.offsetX;
  const drawY = (srcH - imgH) / 2 + cropState.offsetY;

  // Map from 280x280 preview to 240x240 export (the circle area is r=120 centered)
  const cropX = (srcW / 2) - 120;
  const cropY = (srcH / 2) - 120;
  const cropSize = 240;

  // Clip to circle
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  // Draw image offset so the crop area maps correctly
  ctx.drawImage(img, drawX - cropX, drawY - cropY, imgW, imgH);

  pendingPhotoData = exportCanvas.toDataURL('image/png', 0.9);
  closeCropModal();
  render();
}

function removePendingPhoto(event) {
  event.stopPropagation();
  pendingPhotoData = null;
  render();
}

async function addCandidate() {
  const name = document.getElementById('c-name').value.trim();
  const role = document.getElementById('c-role').value;

  if (!name) { showToast('Please fill in candidate name', 'error'); return; }

  try {
    await apiCall('/api/admin/candidates', 'POST', {
      name, role, house: ELECTION_SCOPE, photo: pendingPhotoData || null
    }, true);
    pendingPhotoData = null;
    showToast(`${name} added successfully!`, 'success');
    state.adminActiveView = 'list'; // Switch to list view automatically
    fetchResults();
  } catch (err) {}
}

async function deleteCandidate(id) {
  if (!confirm('Remove this nominee?')) return;
  try {
    await apiCall('/api/admin/candidates/delete', 'POST', { id }, true);
    showToast('Nominee removed', 'success');
    fetchResults();
  } catch (err) {}
}

function exportNominees() {
  const nominees = Object.values(state.candidates || {});
  const payload = {
    type: 'cabinet-election-nominees',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: nominees.length,
    candidates: state.candidates || {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `nominee_list_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`Exported ${nominees.length} nominee${nominees.length === 1 ? '' : 's'}`, 'success');
}

function openNomineeImport() {
  const input = document.getElementById('nominee-import-input');
  if (input) input.click();
}

async function importNominees(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const candidates = parsed.candidates || parsed.nominees || parsed;
    const importCount = Array.isArray(candidates)
      ? candidates.length
      : Object.keys(candidates || {}).length;

    if (!importCount) {
      showToast('No nominees found in that file', 'error');
      return;
    }

    if (!confirm(`Import ${importCount} nominee${importCount === 1 ? '' : 's'}? This will replace the current nominee list.`)) {
      return;
    }

    const res = await apiCall('/api/admin/candidates/import', 'POST', { candidates }, true);
    state.candidates = res.candidates || {};
    showToast(`Imported ${res.count || importCount} nominee${(res.count || importCount) === 1 ? '' : 's'}`, 'success');
    fetchResults();
  } catch (err) {
    showToast(err.message || 'Could not import nominee file', 'error');
  } finally {
    input.value = '';
  }
}

async function resetVotes() {
  if (!confirm('Reset ALL votes? This cannot be undone.')) return;
  try {
    await apiCall('/api/admin/reset-votes', 'POST', {}, true);
    showToast('All votes cleared', 'success');
    fetchResults();
  } catch (err) {}
}

async function resetAll() {
  if (!confirm('Reset ALL data including nominees? This cannot be undone.')) return;
  try {
    await apiCall('/api/admin/reset-all', 'POST', {}, true);
    showToast('All system databases flushed', 'success');
    fetchResults();
  } catch (err) {}
}

function adminLogout() {
  state.adminLoggedIn = false;
  state.adminToken = '';
  sessionStorage.removeItem('hce_token');
  goHome();
}

// ─── EXPORT RESULTS ───────────────────────────────────────
function exportToCSV() {
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Voter Name,Class & Section,Roll Number,Category,Voted Candidate\n";

  Object.values(state.voteLedger).forEach(v => {
    Object.entries(v.votes || {}).forEach(([roleId, candidateId]) => {
      const roleLabel = ROLES.find(r => r.id === roleId)?.label || roleId;
      const candidateName = state.candidates[candidateId]?.name || 'Unknown';
      const row = [
        `"${v.voterName.replace(/"/g, '""')}"`,
        `"${v.section.replace(/"/g, '""')}"`,
        `"${v.roleNo.replace(/"/g, '""')}"`,
        `"${roleLabel}"`,
        `"${candidateName.replace(/"/g, '""')}"`
      ].join(",");
      csvContent += row + "\n";
    });
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `election_results_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("CSV Exported successfully!", "success");
}

function exportToPDF() {
  const printWindow = window.open('', '_blank');
  const tallies = computeTallies();
  const totalVoters = Object.keys(state.voteLedger).length;

  let html = `
  <html>
  <head>
    <title>Election Report - 2026</title>
    <style>
      body { font-family: 'Inter', sans-serif; color: #111; padding: 40px; }
      h1 { font-family: 'Space Grotesk', sans-serif; font-size: 28px; margin-bottom: 5px; }
      .meta { color: #666; font-size: 14px; margin-bottom: 30px; }
      .stats { display: flex; gap: 20px; margin-bottom: 40px; }
      .stat-card { border: 1px solid #ddd; padding: 15px 25px; border-radius: 8px; flex: 1; }
      .stat-label { font-size: 11px; text-transform: uppercase; color: #888; font-weight: 600; margin-bottom: 5px; }
      .stat-val { font-size: 24px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { border-bottom: 1px solid #eee; padding: 12px; text-align: left; }
      th { background: #f9f9f9; font-weight: 600; font-size: 13px; color: #555; }
      td { font-size: 14px; }
      .leader { font-weight: bold; color: #3d5cff; }
    </style>
  </head>
  <body>
    <h1>Cabinet Elections Report 2026</h1>
    <div class="meta">Generated on ${new Date().toLocaleString()} · Total Votes Cast: ${totalVoters}</div>

    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Voters</div>
        <div class="stat-val">${totalVoters}</div>
      </div>
    </div>

    <h2>Results Breakdown</h2>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Candidate Name</th>
          <th>Votes Received</th>
        </tr>
      </thead>
      <tbody>
  `;

  ROLES.forEach(r => {
    const entries = tallies[r.id] || [];
    entries.forEach((entry, idx) => {
      html += `
          <tr>
            <td>${idx === 0 ? r.label : ''}</td>
            <td class="${idx === 0 && entry.votes > 0 ? 'leader' : ''}">${esc(entry.name)} ${idx === 0 && entry.votes > 0 ? 'LEADING' : ''}</td>
            <td>${entry.votes}</td>
          </tr>
        `;
    });
  });

  html += `
      </tbody>
    </table>
    <script>
      window.onload = function() {
        window.print();
        window.close();
      }
    </script>
  </body>
  </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

// ─── NAVIGATION ───────────────────────────────────────────
function goHome() {
  state.page = 'home';
  state.votes = {};
  if (window.location.pathname !== '/') {
    window.history.pushState({}, '', '/');
  }
  render();
}
function goPage(page) {
  state.page = page;
  render();
}
function goAdmin() {
  state.page = state.adminLoggedIn ? 'admin' : 'login';
  if (window.location.pathname !== state.adminPath) {
    window.history.pushState({}, '', state.adminPath);
  }
  if (state.adminLoggedIn) {
    fetchResults();
  } else {
    render();
  }
}

// ─── TOAST ────────────────────────────────────────────────
function buildToast() {
  return `<div class="toast" id="toast"><span class="toast-icon" id="toast-icon"></span><span id="toast-msg"></span></div>`;
}
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  if (!t) return;
  t.className = `toast ${type}`;
  icon.textContent = type === 'success' ? '✓' : '✕';
  msgEl.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── EVENTS ───────────────────────────────────────────────
function attachEvents() {
  const pw = document.getElementById('admin-pw');
  if (pw) pw.focus();
}

// ─── HELPERS ──────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function cap(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function genderEmoji(gender) {
  return gender === 'girl' ? '👧' : '👦';
}
function shortHash(hash) {
  if (!hash) return 'none';
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}
function formatAuditAction(action) {
  return String(action || '').split('_').map(cap).join(' ');
}
function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function formatAuditDetails(entry) {
  const details = entry.details || {};
  const bits = [];
  if (entry.actor) bits.push(`Actor: ${entry.actor}`);
  if (details.voterId) bits.push(`Voter: ${details.voterId}`);
  if (details.candidateId) bits.push(`Candidate: ${details.candidateId}`);
  if (details.role) bits.push(`Role: ${details.role}`);
  if (details.ballotHash) bits.push(`Ballot: ${shortHash(details.ballotHash)}`);
  return bits.join(' · ') || 'No extra details';
}

// ─── ROUTER & INIT ────────────────────────────────────────
window.addEventListener('popstate', () => {
  if (window.location.pathname !== '/') {
    state.adminPath = window.location.pathname;
    state.page = state.adminLoggedIn ? 'admin' : 'login';
  } else {
    state.page = 'home';
    state.votes = {};
  }
  if (state.page === 'admin') {
    fetchResults();
  } else {
    render();
  }
});

// Init load
if (window.location.pathname !== '/') {
  state.adminPath = window.location.pathname;
  localStorage.setItem('hce_admin_path', state.adminPath);
  state.page = state.adminLoggedIn ? 'admin' : 'login';
} else {
  state.page = 'home';
}

fetchCandidates();
if (state.page === 'admin') {
  fetchResults();
} else {
  render();
}
