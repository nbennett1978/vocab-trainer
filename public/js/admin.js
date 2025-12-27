// Vocabulary Trainer - Admin Dashboard

let allWords = [];
let workingSetWords = [];
let entireSetWords = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupForms();
    loadCategories();
    loadWords();
    loadWorkingSet();
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
        const response = await fetch('/api/categories');
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
        const response = await fetch('/admin/api/words');
        const data = await response.json();

        if (data.success) {
            allWords = data.words;
            document.getElementById('word-count').textContent = allWords.length;
            renderWords(allWords);
        }
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

    container.innerHTML = words.map(word => `
        <div class="word-item" data-id="${word.id}">
            <div class="word-main">
                <div class="word-english">${escapeHtml(word.english)}</div>
                <div class="word-turkish">${escapeHtml(word.turkish)}</div>
                ${word.example_sentence ? `<div class="word-sentence">${escapeHtml(word.example_sentence)}</div>` : ''}
            </div>
            <span class="word-category">${word.category}</span>
            <div class="word-progress">
                ${word.progress.en_to_tr ? `EN→TR: Box ${word.progress.en_to_tr.box}` : ''}<br>
                ${word.progress.tr_to_en ? `TR→EN: Box ${word.progress.tr_to_en.box}` : ''}
            </div>
            <div class="word-actions">
                <button class="btn btn-secondary btn-sm" onclick="editWord(${word.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteWord(${word.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

// Load working set
async function loadWorkingSet() {
    try {
        const response = await fetch('/admin/api/working-set');
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
    try {
        const response = await fetch('/admin/api/entire-set');
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
        const response = await fetch('/admin/api/words', {
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
        const response = await fetch('/admin/api/words/upload', {
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
function editWord(id) {
    const word = allWords.find(w => w.id === id);
    if (!word) return;

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
        const response = await fetch(`/admin/api/words/${id}`, {
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
        const response = await fetch(`/admin/api/words/${id}`, {
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
    try {
        const response = await fetch('/admin/api/progress');
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
        const response = await fetch('/admin/api/reset', {
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
        const response = await fetch('/admin/api/settings');
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
        const response = await fetch('/admin/api/settings', {
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

// Make functions globally accessible
window.editWord = editWord;
window.deleteWord = deleteWord;
window.closeModal = closeModal;
