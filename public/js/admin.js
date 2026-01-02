// Vocabulary Trainer - Admin Dashboard

let allWords = [];
let workingSetWords = [];
let entireSetWords = [];
let currentUser = null;
let selectedUserId = null; // For viewing specific user's progress
let audioStatus = {}; // Track which words have audio files

// ============================================
// AUTHENTICATION
// ============================================

function getToken() {
    return localStorage.getItem('auth_token');
}

function setToken(token) {
    localStorage.setItem('auth_token', token);
}

function clearToken() {
    localStorage.removeItem('auth_token');
}

function setUser(user) {
    currentUser = user;
    localStorage.setItem('user', JSON.stringify(user));
}

function getUser() {
    if (currentUser) return currentUser;
    const stored = localStorage.getItem('user');
    if (stored) {
        currentUser = JSON.parse(stored);
        return currentUser;
    }
    return null;
}

function clearUser() {
    currentUser = null;
    localStorage.removeItem('user');
}

// API fetch with auth header
async function apiFetch(url, options = {}) {
    const token = getToken();
    if (token) {
        options.headers = {
            ...options.headers,
            'Authorization': `Bearer ${token}`
        };
    }

    const response = await fetch(url, options);

    // Handle 401/403 - redirect to login
    if (response.status === 401 || response.status === 403) {
        clearToken();
        clearUser();
        window.location.href = '/';
        throw new Error('Session expired. Please login again.');
    }

    return response;
}

// Check if already logged in and is admin
async function checkAuth() {
    const token = getToken();
    if (!token) {
        window.location.href = '/';
        return false;
    }

    try {
        const response = await apiFetch('/api/auth/me');
        const data = await response.json();

        if (data.success && data.user && data.user.is_admin) {
            setUser(data.user);
            return true;
        } else {
            // Not admin - redirect to learner view
            window.location.href = '/';
            return false;
        }
    } catch (e) {
        // Token invalid
        clearToken();
        clearUser();
        window.location.href = '/';
        return false;
    }
}

// Logout function
async function logout() {
    try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
        // Ignore errors on logout
    }

    clearToken();
    clearUser();
    window.location.href = '/';
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth first
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) return;

    setupTabs();
    setupForms();
    loadCategories();
    loadWords();
    loadUsers();
    loadProgress();
    loadSettings();
});

// Tab navigation
function setupTabs() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update nav buttons
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update tab content
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');

            // Refresh data when switching tabs
            if (btn.dataset.tab === 'words') loadWords();
            if (btn.dataset.tab === 'users') loadUsersList();
            if (btn.dataset.tab === 'working-set') loadWorkingSet();
            if (btn.dataset.tab === 'entire-set') loadEntireSet();
            if (btn.dataset.tab === 'progress') loadProgress();
            if (btn.dataset.tab === 'settings') loadSettings();
        });
    });
}

// Setup forms
function setupForms() {
    // Add word form
    document.getElementById('add-word-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await addWord();
    });

    // Upload form
    document.getElementById('upload-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await uploadFile();
    });

    // Edit word form
    document.getElementById('edit-word-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveEdit();
    });

    // Settings form
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSettings();
    });

    // Reset progress button
    document.getElementById('reset-progress-btn').addEventListener('click', resetProgress);

    // Add user form
    document.getElementById('add-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createUser();
    });

    // Reset password form
    document.getElementById('reset-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitResetPassword();
    });

    // Search and filter
    document.getElementById('search-input').addEventListener('input', filterWords);
    document.getElementById('filter-category').addEventListener('change', filterWords);

    // New category toggle for bulk upload
    document.getElementById('upload-category').addEventListener('change', (e) => {
        const newCategoryInput = document.getElementById('upload-new-category');
        if (e.target.value === '__new__') {
            newCategoryInput.classList.remove('hidden');
            newCategoryInput.focus();
        } else {
            newCategoryInput.classList.add('hidden');
            newCategoryInput.value = '';
        }
    });

    // Working set category filter
    document.getElementById('ws-filter-category').addEventListener('change', filterWorkingSet);

    // Entire set category filter
    document.getElementById('es-filter-category').addEventListener('change', filterEntireSet);
}

// Load categories from server
async function loadCategories() {
    try {
        const response = await apiFetch('/api/categories');
        const data = await response.json();

        if (data.success) {
            const categories = data.categories.filter(c => c !== 'all');

            // Update upload category dropdown
            const uploadSelect = document.getElementById('upload-category');
            const currentUploadOptions = `
                <option value="">Auto-detect from filename</option>
                ${categories.map(cat => `<option value="${cat}">${capitalize(cat)}</option>`).join('')}
                <option value="__new__">+ New category...</option>
            `;
            uploadSelect.innerHTML = currentUploadOptions;

            // Update filter category dropdown
            const filterSelect = document.getElementById('filter-category');
            filterSelect.innerHTML = `
                <option value="">All Categories</option>
                ${categories.map(cat => `<option value="${cat}">${capitalize(cat)}</option>`).join('')}
            `;

            // Update working set filter dropdown
            const wsFilterSelect = document.getElementById('ws-filter-category');
            wsFilterSelect.innerHTML = `
                <option value="">All Categories</option>
                ${categories.map(cat => `<option value="${cat}">${capitalize(cat)}</option>`).join('')}
            `;

            // Update entire set filter dropdown
            const esFilterSelect = document.getElementById('es-filter-category');
            esFilterSelect.innerHTML = `
                <option value="">All Categories</option>
                ${categories.map(cat => `<option value="${cat}">${capitalize(cat)}</option>`).join('')}
            `;
        }
    } catch (error) {
        console.error('Load categories error:', error);
    }
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Load words
async function loadWords() {
    try {
        // Load words and audio status in parallel
        const [wordsResponse, audioResponse] = await Promise.all([
            apiFetch('/admin/api/words'),
            apiFetch('/admin/api/audio/status')
        ]);

        const wordsData = await wordsResponse.json();
        const audioData = await audioResponse.json();

        if (wordsData.success) {
            allWords = wordsData.words;
            document.getElementById('word-count').textContent = allWords.length;
        }

        if (audioData.success) {
            audioStatus = audioData.audioStatus;
        }

        // Update audio stats display
        updateAudioStats();

        renderWords(allWords);
    } catch (error) {
        console.error('Load words error:', error);
    }
}

// Render words
function renderWords(words) {
    const container = document.getElementById('words-list');

    if (words.length === 0) {
        container.innerHTML = '<p class="loading">No words found</p>';
        return;
    }

    container.innerHTML = words.map(word => {
        const hasAudio = audioStatus[word.id] || false;
        return `
            <div class="word-item" data-id="${word.id}">
                <div class="word-main">
                    <div class="word-english">${escapeHtml(word.english)}</div>
                    <div class="word-turkish">${escapeHtml(word.turkish)}</div>
                    ${word.example_sentence ? `<div class="word-sentence">${escapeHtml(word.example_sentence)}</div>` : ''}
                </div>
                <div class="word-audio">
                    ${hasAudio
                        ? `<span class="audio-status has-audio" title="Has audio">🔊</span>
                           <button class="btn btn-sm btn-icon" onclick="playAudio(${word.id})" title="Play">▶</button>
                           <button class="btn btn-sm btn-icon btn-danger" onclick="deleteAudio(${word.id})" title="Delete audio">🗑</button>`
                        : `<span class="audio-status no-audio" title="No audio">🔇</span>
                           <button class="btn btn-sm btn-secondary" onclick="generateAudio(${word.id}, '${escapeHtml(word.english).replace(/'/g, "\\'")}')">Generate</button>`
                    }
                </div>
                <span class="word-category">${word.category}</span>
                <div class="word-actions">
                    <button class="btn btn-secondary btn-sm" onclick="editWord(${word.id})">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteWord(${word.id})">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

// Load users list
async function loadUsers() {
    try {
        const response = await apiFetch('/admin/api/users');
        const data = await response.json();

        if (data.success) {
            const users = data.users.filter(u => !u.is_admin);
            // Set first user as selected if none selected
            if (!selectedUserId && users.length > 0) {
                selectedUserId = users[0].id;
            }
            renderUserSelector(users);
            // Now load working set for selected user
            loadWorkingSet();
        }
    } catch (error) {
        console.error('Load users error:', error);
    }
}

// Render user selector - updates all three user selectors
function renderUserSelector(users) {
    const selectors = [
        document.getElementById('user-selector'),
        document.getElementById('es-user-selector'),
        document.getElementById('progress-user-selector')
    ];

    const optionsHtml = users.map(user => `
        <option value="${user.id}" ${user.id === selectedUserId ? 'selected' : ''}>
            ${escapeHtml(user.username)} ${user.stats ? `(${user.stats.totalStars}⭐)` : ''}
        </option>
    `).join('');

    selectors.forEach(container => {
        if (container) {
            container.innerHTML = optionsHtml;
        }
    });
}

// Sync all user selectors to the current selectedUserId
function syncUserSelectors() {
    const selectors = [
        document.getElementById('user-selector'),
        document.getElementById('es-user-selector'),
        document.getElementById('progress-user-selector')
    ];

    selectors.forEach(container => {
        if (container && selectedUserId) {
            container.value = selectedUserId;
        }
    });
}

// Load working set
async function loadWorkingSet() {
    if (!selectedUserId) return;
    syncUserSelectors();
    try {
        const response = await apiFetch(`/admin/api/working-set?user_id=${selectedUserId}`);
        const data = await response.json();

        if (data.success) {
            const { words, count, overallSuccessRate } = data.data;
            workingSetWords = words;

            // Update stats
            document.getElementById('ws-count').textContent = count;
            document.getElementById('ws-success-rate').textContent = `${overallSuccessRate}%`;

            // Render working set list (apply current filter)
            filterWorkingSet();
        }
    } catch (error) {
        console.error('Load working set error:', error);
    }
}

// Filter working set
function filterWorkingSet() {
    const category = document.getElementById('ws-filter-category').value;
    const filtered = category
        ? workingSetWords.filter(w => w.category === category)
        : workingSetWords;
    renderWorkingSet(filtered);
}

// Render working set
function renderWorkingSet(words) {
    const container = document.getElementById('working-set-list');

    if (words.length === 0) {
        container.innerHTML = '<p class="loading">No words in working set yet. Start a session to initialize.</p>';
        return;
    }

    container.innerHTML = words.map(word => renderWordItem(word)).join('');
}

// Load entire set
async function loadEntireSet() {
    if (!selectedUserId) return;
    syncUserSelectors();
    try {
        const response = await apiFetch(`/admin/api/entire-set?user_id=${selectedUserId}`);
        const data = await response.json();

        if (data.success) {
            const { words, count, inWorkingSet, notStarted } = data.data;
            entireSetWords = words;

            // Update stats
            document.getElementById('es-count').textContent = count;
            document.getElementById('es-in-working-set').textContent = inWorkingSet;
            document.getElementById('es-not-started').textContent = notStarted;

            // Render entire set list (apply current filter)
            filterEntireSet();
        }
    } catch (error) {
        console.error('Load entire set error:', error);
    }
}

// Filter entire set
function filterEntireSet() {
    const category = document.getElementById('es-filter-category').value;
    const filtered = category
        ? entireSetWords.filter(w => w.category === category)
        : entireSetWords;
    renderEntireSet(filtered);
}

// Render entire set
function renderEntireSet(words) {
    const container = document.getElementById('entire-set-list');

    if (words.length === 0) {
        container.innerHTML = '<p class="loading">No words in database yet.</p>';
        return;
    }

    container.innerHTML = words.map(word => renderWordItem(word)).join('');
}

// Shared render function for word items
function renderWordItem(word) {
    const successClass = word.successRatePercent === null ? ''
        : word.successRatePercent >= 60 ? 'good'
        : word.successRatePercent >= 40 ? 'medium'
        : 'bad';

    return `
        <div class="ws-word-item">
            <div class="ws-word-main">
                <div class="ws-word-english">${escapeHtml(word.english)}</div>
                <div class="ws-word-turkish">${escapeHtml(word.turkish)}</div>
            </div>
            <span class="ws-word-category">${word.category}</span>
            <div class="ws-word-boxes">
                <span class="ws-box box-${word.en_to_tr.box}">EN→TR: Box ${word.en_to_tr.box}</span>
                <span class="ws-box box-${word.tr_to_en.box}">TR→EN: Box ${word.tr_to_en.box}</span>
            </div>
            <div class="ws-success-rate">
                <div class="ws-success-value ${successClass}">
                    ${word.successRatePercent !== null ? word.successRatePercent + '%' : '-'}
                </div>
                <div class="ws-success-detail">
                    ${word.totalCorrect}/${word.totalAsked}
                </div>
            </div>
        </div>
    `;
}

// Filter words
function filterWords() {
    const search = document.getElementById('search-input').value.toLowerCase();
    const category = document.getElementById('filter-category').value;

    const filtered = allWords.filter(word => {
        const matchesSearch = word.english.toLowerCase().includes(search) ||
                             word.turkish.toLowerCase().includes(search);
        const matchesCategory = !category || word.category === category;
        return matchesSearch && matchesCategory;
    });

    renderWords(filtered);
}

// Add word
async function addWord() {
    const english = document.getElementById('new-english').value.trim();
    const turkish = document.getElementById('new-turkish').value.trim();
    const category = document.getElementById('new-category').value;
    const sentence = document.getElementById('new-sentence').value.trim();

    try {
        const response = await apiFetch('/admin/api/words', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                english,
                turkish,
                category,
                example_sentence: sentence || null
            })
        });

        const data = await response.json();

        if (data.success) {
            alert('Word added successfully!');
            document.getElementById('add-word-form').reset();
            loadWords();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error adding word: ' + error.message);
    }
}

// Upload file
async function uploadFile() {
    const fileInput = document.getElementById('upload-file');
    let category = document.getElementById('upload-category').value;
    const newCategoryInput = document.getElementById('upload-new-category');
    const resultsDiv = document.getElementById('upload-results');

    // Handle new category
    if (category === '__new__') {
        category = newCategoryInput.value.trim().toLowerCase();
        if (!category) {
            alert('Please enter a category name');
            newCategoryInput.focus();
            return;
        }
    }

    if (!fileInput.files[0]) {
        alert('Please select a file');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    if (category) formData.append('category', category);

    try {
        const response = await apiFetch('/admin/api/words/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        resultsDiv.classList.remove('hidden', 'success', 'error');

        if (data.success) {
            resultsDiv.classList.add('success');
            resultsDiv.innerHTML = `
                <strong>Upload complete!</strong><br>
                Added: ${data.results.added} words<br>
                Skipped (duplicates): ${data.results.skipped}<br>
                ${data.results.errors.length > 0 ? `Errors: ${data.results.errors.length}` : ''}
            `;
            document.getElementById('upload-form').reset();
            document.getElementById('upload-new-category').classList.add('hidden');
            loadCategories();
            loadWords();
        } else {
            resultsDiv.classList.add('error');
            resultsDiv.textContent = 'Error: ' + data.error;
        }
    } catch (error) {
        resultsDiv.classList.remove('hidden');
        resultsDiv.classList.add('error');
        resultsDiv.textContent = 'Error uploading file: ' + error.message;
    }
}

// Edit word
async function editWord(id) {
    const word = allWords.find(w => w.id === id);
    if (!word) return;

    // Populate edit category dropdown with all existing categories
    try {
        const response = await apiFetch('/api/categories');
        const data = await response.json();
        if (data.success) {
            const categories = data.categories.filter(c => c !== 'all');
            const editCategorySelect = document.getElementById('edit-category');

            // Build options including all existing categories
            const defaultCategories = ['verb', 'noun', 'adjective', 'adverb', 'other'];
            const allCategories = [...new Set([...defaultCategories, ...categories])].sort();

            editCategorySelect.innerHTML = allCategories
                .map(cat => `<option value="${cat}">${capitalize(cat)}</option>`)
                .join('');
        }
    } catch (error) {
        console.error('Error loading categories for edit:', error);
    }

    document.getElementById('edit-id').value = word.id;
    document.getElementById('edit-english').value = word.english;
    document.getElementById('edit-turkish').value = word.turkish;
    document.getElementById('edit-category').value = word.category;
    document.getElementById('edit-sentence').value = word.example_sentence || '';

    document.getElementById('edit-modal').classList.remove('hidden');
}

// Save edit
async function saveEdit() {
    const id = document.getElementById('edit-id').value;
    const english = document.getElementById('edit-english').value.trim();
    const turkish = document.getElementById('edit-turkish').value.trim();
    const category = document.getElementById('edit-category').value;
    const sentence = document.getElementById('edit-sentence').value.trim();

    try {
        const response = await apiFetch(`/admin/api/words/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                english,
                turkish,
                category,
                example_sentence: sentence || null
            })
        });

        const data = await response.json();

        if (data.success) {
            closeModal();
            loadWords();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error saving changes: ' + error.message);
    }
}

// Close modal
function closeModal() {
    document.getElementById('edit-modal').classList.add('hidden');
}

// Delete word
async function deleteWord(id) {
    const word = allWords.find(w => w.id === id);
    if (!confirm(`Delete "${word?.english}"? This will also remove all progress for this word.`)) {
        return;
    }

    try {
        const response = await apiFetch(`/admin/api/words/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            loadWords();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error deleting word: ' + error.message);
    }
}

// Load progress
async function loadProgress() {
    if (!selectedUserId) return;
    syncUserSelectors();
    try {
        const response = await apiFetch(`/admin/api/progress?user_id=${selectedUserId}`);
        const data = await response.json();

        if (data.success) {
            const { progress, learner, recentSessions, achievements } = data.data;

            // Update stats
            document.getElementById('stat-total-stars').textContent = learner.total_stars;
            document.getElementById('stat-current-streak').textContent = learner.current_streak;
            document.getElementById('stat-longest-streak').textContent = learner.longest_streak;
            document.getElementById('stat-last-active').textContent = learner.last_active_date || 'Never';

            // Update Leitner boxes
            renderBoxBars('en-to-tr-boxes', progress.byDirection.en_to_tr);
            renderBoxBars('tr-to-en-boxes', progress.byDirection.tr_to_en);

            // Update mastery summary
            document.getElementById('fully-mastered').textContent = progress.fullyMastered;
            document.getElementById('total-words-progress').textContent = progress.totalWords;

            // Update recent sessions
            renderSessions(recentSessions);

            // Update achievements
            renderAchievements(achievements);
        }
    } catch (error) {
        console.error('Load progress error:', error);
    }
}

// Render box bars
function renderBoxBars(containerId, boxes) {
    const container = document.getElementById(containerId);
    const total = Object.values(boxes).reduce((a, b) => a + b, 0);
    const maxCount = Math.max(...Object.values(boxes), 1);

    const boxLabels = ['Not Started', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5'];

    container.innerHTML = [0, 1, 2, 3, 4, 5].map(box => {
        const count = boxes[box] || 0;
        const width = total > 0 ? (count / maxCount) * 100 : 0;

        return `
            <div class="box-bar" data-box="${box}">
                <span class="label">${boxLabels[box]}</span>
                <div class="bar">
                    <div class="fill" style="width: ${width}%"></div>
                </div>
                <span class="count">${count}</span>
            </div>
        `;
    }).join('');
}

// Render sessions
function renderSessions(sessions) {
    const container = document.getElementById('recent-sessions');

    if (sessions.length === 0) {
        container.innerHTML = '<p class="loading">No sessions yet</p>';
        return;
    }

    container.innerHTML = sessions.map(session => `
        <div class="session-item">
            <div>
                <span class="session-type">${session.session_type}</span>
                <span class="session-date">${formatDate(session.started_at)}</span>
            </div>
            <div class="session-stats">
                <span class="correct">${session.words_correct}</span> / ${session.words_asked}
                (⭐ ${session.stars_earned})
            </div>
        </div>
    `).join('');
}

// Render achievements
function renderAchievements(achievements) {
    const container = document.getElementById('achievements-list-admin');

    if (achievements.length === 0) {
        container.innerHTML = '<p class="loading">No achievements yet</p>';
        return;
    }

    container.innerHTML = achievements.map(a => {
        const label = a.type.startsWith('mastered_')
            ? `🏆 ${a.type.split('_')[1]} Words`
            : a.type.startsWith('streak_')
                ? `🔥 ${a.type.split('_')[1]} Day Streak`
                : a.type;

        return `<span class="achievement-item">${label}</span>`;
    }).join('');
}

// Reset progress
async function resetProgress() {
    if (!confirm('Are you sure you want to reset ALL learning progress? This cannot be undone!')) {
        return;
    }

    if (!confirm('Really? All progress, streaks, and achievements will be lost. Type "RESET" in the next prompt to confirm.')) {
        return;
    }

    const confirmation = prompt('Type RESET to confirm:');
    if (confirmation !== 'RESET') {
        alert('Reset cancelled');
        return;
    }

    try {
        const response = await apiFetch('/admin/api/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: 'RESET' })
        });

        const data = await response.json();

        if (data.success) {
            alert('Progress has been reset');
            loadProgress();
            loadWords();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error resetting progress: ' + error.message);
    }
}

// Load settings
async function loadSettings() {
    try {
        const response = await apiFetch('/admin/api/settings');
        const data = await response.json();

        if (data.success) {
            const s = data.settings;
            document.getElementById('setting-quick').value = s.quick_lesson_count || 5;
            document.getElementById('setting-weak-words').value = s.weak_words_count || 5;
            document.getElementById('setting-review-chance').value = s.mastered_review_chance || 0.1;
            document.getElementById('setting-answer-timeout').value = s.answer_timeout || 30;
            document.getElementById('setting-timezone').value = s.timezone || 'Europe/Istanbul';
        }
    } catch (error) {
        console.error('Load settings error:', error);
    }
}

// Save settings
async function saveSettings() {
    const settings = {
        quick_lesson_count: document.getElementById('setting-quick').value,
        weak_words_count: document.getElementById('setting-weak-words').value,
        mastered_review_chance: document.getElementById('setting-review-chance').value,
        answer_timeout: document.getElementById('setting-answer-timeout').value,
        timezone: document.getElementById('setting-timezone').value
    };

    try {
        const response = await apiFetch('/admin/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        const data = await response.json();

        if (data.success) {
            alert('Settings saved!');
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error saving settings: ' + error.message);
    }
}

// ============================================
// USER MANAGEMENT
// ============================================

let allUsers = [];

// Load users list for the Users tab
async function loadUsersList() {
    try {
        const response = await apiFetch('/admin/api/users');
        const data = await response.json();

        if (data.success) {
            allUsers = data.users;
            document.getElementById('user-count').textContent = allUsers.length;
            renderUsersList(allUsers);
        }
    } catch (error) {
        console.error('Load users error:', error);
    }
}

// Render users list
function renderUsersList(users) {
    const container = document.getElementById('users-list');

    if (users.length === 0) {
        container.innerHTML = '<p class="loading">No users found</p>';
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="user-item" data-id="${user.id}">
            <div class="user-main">
                <div class="user-username">${escapeHtml(user.username)}</div>
                <div class="user-role ${user.is_admin ? 'admin' : 'student'}">${user.is_admin ? 'Admin' : 'Student'}</div>
            </div>
            <div class="user-stats">
                ${user.stats ? `
                    <span class="stat">⭐ ${user.stats.totalStars}</span>
                    <span class="stat">🔥 ${user.stats.currentStreak}</span>
                    ${user.stats.lastActiveDate ? `<span class="stat">Last active: ${user.stats.lastActiveDate}</span>` : ''}
                ` : '<span class="stat">No activity yet</span>'}
            </div>
            <div class="user-actions">
                ${!user.is_admin ? `
                    <button class="btn btn-secondary btn-sm" onclick="openResetModal(${user.id}, '${escapeHtml(user.username)}')">Reset Password</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">Delete</button>
                ` : '<span class="admin-badge">Protected</span>'}
            </div>
        </div>
    `).join('');
}

// Create new user
async function createUser() {
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;

    if (!username || !password) {
        alert('Please fill in all fields');
        return;
    }

    try {
        const response = await apiFetch('/admin/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                is_admin: role === 'admin'
            })
        });

        const data = await response.json();

        if (data.success) {
            alert(`User "${username}" created successfully!`);
            document.getElementById('add-user-form').reset();
            loadUsersList();
            loadUsers(); // Refresh user selector dropdowns
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error creating user: ' + error.message);
    }
}

// Delete user
async function deleteUser(userId, username) {
    if (!confirm(`Are you sure you want to delete user "${username}"?\nThis will delete all their progress!`)) {
        return;
    }

    try {
        const response = await apiFetch(`/admin/api/users/${userId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            alert(`User "${username}" deleted successfully!`);
            loadUsersList();
            loadUsers(); // Refresh user selector dropdowns
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error deleting user: ' + error.message);
    }
}

// Open reset password modal
function openResetModal(userId, username) {
    document.getElementById('reset-user-id').value = userId;
    document.getElementById('reset-username').textContent = username;
    document.getElementById('reset-new-password').value = '';
    document.getElementById('reset-password-modal').classList.remove('hidden');
}

// Close reset password modal
function closeResetModal() {
    document.getElementById('reset-password-modal').classList.add('hidden');
}

// Submit reset password
async function submitResetPassword() {
    const userId = document.getElementById('reset-user-id').value;
    const password = document.getElementById('reset-new-password').value;

    if (!password || password.length < 4) {
        alert('Password must be at least 4 characters');
        return;
    }

    try {
        const response = await apiFetch(`/admin/api/users/${userId}/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (data.success) {
            alert('Password reset successfully!');
            closeResetModal();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error resetting password: ' + error.message);
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ============================================
// AUDIO FUNCTIONS
// ============================================

// Update audio stats display
function updateAudioStats() {
    const total = allWords.length;
    const withAudio = Object.values(audioStatus).filter(Boolean).length;
    const missing = total - withAudio;

    const statsEl = document.getElementById('audio-stats');
    const btnEl = document.getElementById('generate-all-audio-btn');

    if (statsEl) {
        statsEl.textContent = `${withAudio}/${total} with audio`;
    }

    if (btnEl) {
        btnEl.disabled = missing === 0;
        if (missing === 0) {
            btnEl.textContent = '✓ All audio generated';
        } else {
            btnEl.textContent = `🔊 Generate All Audio (${missing})`;
        }
    }
}

// Play audio for a word
function playAudio(wordId) {
    const audio = new Audio(`/api/audio/${wordId}`);
    audio.play().catch(err => console.error('Error playing audio:', err));
}

// Generate audio for a word using Puter TTS
async function generateAudio(wordId, englishWord) {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generating...';

    try {
        // Use Puter TTS to generate audio
        const audio = await puter.ai.txt2speech(englishWord, {
            voice: "Joanna",
            engine: "neural",
            language: "en-US"
        });

        // Get the audio blob from the audio element
        // Puter returns an Audio element with a blob URL
        const response = await fetch(audio.src);
        const blob = await response.blob();

        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64data = reader.result.split(',')[1];

            // Upload to server
            const uploadResponse = await apiFetch(`/admin/api/words/${wordId}/audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioData: base64data })
            });

            const result = await uploadResponse.json();

            if (result.success) {
                // Update local status and re-render
                audioStatus[wordId] = true;
                updateAudioStats();
                filterWords();
            } else {
                alert('Failed to save audio: ' + result.error);
            }
        };
        reader.readAsDataURL(blob);

    } catch (error) {
        console.error('Error generating audio:', error);
        alert('Failed to generate audio: ' + error.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// Delete audio for a word
async function deleteAudio(wordId) {
    if (!confirm('Delete audio for this word?')) return;

    try {
        const response = await apiFetch(`/admin/api/words/${wordId}/audio`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            // Update local status and re-render
            audioStatus[wordId] = false;
            updateAudioStats();
            filterWords();
        } else {
            alert('Failed to delete audio: ' + result.error);
        }
    } catch (error) {
        console.error('Error deleting audio:', error);
        alert('Failed to delete audio: ' + error.message);
    }
}

// Generate audio for all words that don't have audio
async function generateAllAudio() {
    // Get words without audio
    const wordsWithoutAudio = allWords.filter(w => !audioStatus[w.id]);

    if (wordsWithoutAudio.length === 0) {
        alert('All words already have audio!');
        return;
    }

    if (!confirm(`Generate audio for ${wordsWithoutAudio.length} words? This may take a while.`)) {
        return;
    }

    const btn = document.getElementById('generate-all-audio-btn');
    const progressDiv = document.getElementById('audio-progress');
    const progressBar = document.getElementById('audio-progress-bar');
    const progressText = document.getElementById('audio-progress-text');

    btn.disabled = true;
    progressDiv.classList.remove('hidden');

    let completed = 0;
    let failed = 0;
    const total = wordsWithoutAudio.length;

    for (const word of wordsWithoutAudio) {
        try {
            // Update progress display
            progressText.textContent = `${completed + 1} / ${total}`;
            progressBar.style.width = `${((completed + 1) / total) * 100}%`;

            // Generate audio using Puter TTS
            const audio = await puter.ai.txt2speech(word.english, {
                voice: "Joanna",
                engine: "neural",
                language: "en-US"
            });

            // Get the audio blob
            const response = await fetch(audio.src);
            const blob = await response.blob();

            // Convert to base64 and upload
            const base64data = await blobToBase64(blob);

            const uploadResponse = await apiFetch(`/admin/api/words/${word.id}/audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioData: base64data })
            });

            const result = await uploadResponse.json();

            if (result.success) {
                audioStatus[word.id] = true;
                completed++;
            } else {
                failed++;
                console.error(`Failed to save audio for "${word.english}":`, result.error);
            }

        } catch (error) {
            failed++;
            console.error(`Failed to generate audio for "${word.english}":`, error);
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Done - update UI
    progressDiv.classList.add('hidden');
    updateAudioStats();
    filterWords();

    if (failed > 0) {
        alert(`Completed! ${completed} succeeded, ${failed} failed.`);
    } else {
        alert(`All ${completed} audio files generated successfully!`);
    }
}

// Helper to convert blob to base64
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Make functions globally accessible
window.editWord = editWord;
window.deleteWord = deleteWord;
window.closeModal = closeModal;
window.openResetModal = openResetModal;
window.closeResetModal = closeResetModal;
window.deleteUser = deleteUser;
window.playAudio = playAudio;
window.generateAudio = generateAudio;
window.deleteAudio = deleteAudio;
window.generateAllAudio = generateAllAudio;
