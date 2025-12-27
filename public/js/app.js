// Vocabulary Trainer - Learner App

// State
let currentSession = null;
let isRetryMode = false;
let currentWordData = null;
let isPopupOpen = false;
let lastSessionType = 'quick';

// DOM Elements
const screens = {
    dashboard: document.getElementById('dashboard-screen'),
    training: document.getElementById('training-screen'),
    results: document.getElementById('results-screen'),
    noWords: document.getElementById('no-words-screen')
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // Session buttons
    document.querySelectorAll('.session-btn').forEach(btn => {
        btn.addEventListener('click', () => startSession(btn.dataset.type));
    });

    // Back button
    document.getElementById('back-btn').addEventListener('click', () => {
        if (confirm('Dersi bitirmek istediğinden emin misin?')) {
            showScreen('dashboard');
            loadDashboard();
        }
    });

    // Answer input
    const answerInput = document.getElementById('answer-input');
    answerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitAnswer();
    });

    // Global keypress for popup
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && isPopupOpen) {
            closeWrongPopup();
        }
    });

    // Submit button
    document.getElementById('submit-btn').addEventListener('click', submitAnswer);

    // Next button
    document.getElementById('next-btn').addEventListener('click', nextWord);

    // Back to dashboard
    document.getElementById('back-to-dashboard').addEventListener('click', () => {
        showScreen('dashboard');
        loadDashboard();
    });

    // Another lesson button
    document.getElementById('another-lesson').addEventListener('click', () => {
        startSession(lastSessionType);
    });
}

// Show screen
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenName]?.classList.add('active');
}

// Show/hide loading
function setLoading(show) {
    document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

// Load dashboard data
async function loadDashboard() {
    setLoading(true);
    try {
        const response = await fetch('/api/dashboard');
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error);
        }

        const { stats, progress, achievements, recentActivity, totalWords, allMastered, inactivityMessage, quickLessonCount } = data.data;

        // Update stats
        document.getElementById('total-stars').textContent = stats.totalStars;
        document.getElementById('current-streak').textContent = stats.currentStreak;

        // Update quick lesson button with dynamic word count
        document.querySelector('.quick-btn .btn-desc').textContent = `${quickLessonCount} kelime`;

        // Update Leitner boxes
        const enToTr = progress.byDirection.en_to_tr;
        const trToEn = progress.byDirection.tr_to_en;

        for (let box = 1; box <= 5; box++) {
            const count = (enToTr[box] || 0) + (trToEn[box] || 0);
            document.getElementById(`box-${box}-count`).textContent = count;
        }

        // Update mastery info
        document.getElementById('mastered-count').textContent = progress.fullyMastered;
        document.getElementById('total-words').textContent = progress.totalWords;

        // Update inactivity message
        const inactivityEl = document.getElementById('inactivity-message');
        if (inactivityMessage) {
            inactivityEl.textContent = inactivityMessage;
            inactivityEl.classList.remove('hidden');
        } else {
            inactivityEl.classList.add('hidden');
        }

        // Update achievements
        const achievementsList = document.getElementById('achievements-list');
        if (achievements.length > 0) {
            achievementsList.innerHTML = achievements.map(a =>
                `<span class="achievement-badge">${getAchievementEmoji(a.type)} ${getAchievementLabel(a.type)}</span>`
            ).join('');
        } else {
            achievementsList.innerHTML = '<p class="no-achievements">Yeni şeyler öğrenmek için harika bir gün! 🌸✨</p>';
        }

        // Render weekly activity tracker
        renderWeeklyTracker(recentActivity || []);

        // Load categories
        await loadCategories();

        // Show appropriate screen
        if (totalWords === 0) {
            showScreen('noWords');
        } else {
            showScreen('dashboard');
        }

    } catch (error) {
        console.error('Dashboard load error:', error);
        alert('Bir hata oluştu: ' + error.message);
    } finally {
        setLoading(false);
    }
}

// Load categories
async function loadCategories() {
    try {
        const response = await fetch('/api/categories');
        const data = await response.json();

        if (data.success) {
            const select = document.getElementById('category-select');
            select.innerHTML = data.categories.map(cat =>
                `<option value="${cat}">${cat === 'all' ? 'Tümü' : capitalizeFirst(cat)}</option>`
            ).join('');
        }
    } catch (error) {
        console.error('Categories load error:', error);
    }
}

// Start a training session
async function startSession(type) {
    setLoading(true);
    lastSessionType = type;
    try {
        const category = document.getElementById('category-select').value;
        const response = await fetch(`/api/session/start?type=${type}&category=${category}`);
        const data = await response.json();

        if (!data.success) {
            if (data.allMastered) {
                alert('Tüm kelimeleri öğrendin! 🎉 Tekrar modunu dene.');
            } else {
                alert(data.error || 'Ders başlatılamadı');
            }
            return;
        }

        currentSession = {
            id: data.sessionId,
            direction: data.direction,
            totalWords: data.totalWords,
            currentIndex: 0,
            stars: 0
        };

        isRetryMode = false;
        showScreen('training');
        displayWord(data.currentWord);

    } catch (error) {
        console.error('Start session error:', error);
        alert('Bir hata oluştu: ' + error.message);
    } finally {
        setLoading(false);
    }
}

// Display current word
function displayWord(wordData) {
    // Store current word data for popup
    currentWordData = wordData;

    // Update progress
    document.getElementById('current-word-num').textContent = wordData.index + 1;
    document.getElementById('total-word-num').textContent = wordData.total;
    document.getElementById('session-stars').textContent = currentSession.stars;

    // Update progress bar
    const progress = (wordData.index / wordData.total) * 100;
    document.getElementById('progress-bar').style.width = `${progress}%`;

    // Update direction indicator
    const isEnToTr = wordData.direction === 'en_to_tr';
    document.querySelector('.from-lang').textContent = isEnToTr ? 'EN' : 'TR';
    document.querySelector('.to-lang').textContent = isEnToTr ? 'TR' : 'EN';

    // Update word stats
    const statsText = wordData.stats.isNew
        ? '✨ Yeni kelime!'
        : `${wordData.stats.timesAsked}x soruldu, ${wordData.stats.timesCorrect}x doğru`;
    document.querySelector('.stats-text').textContent = statsText;

    // Update question
    document.getElementById('question-word').textContent = wordData.question;
    document.getElementById('category-badge').textContent = wordData.category;

    // Update answer hint as input placeholder (underscores)
    const answerInput = document.getElementById('answer-input');
    if (wordData.answerHint) {
        answerInput.placeholder = wordData.answerHint;
    } else {
        answerInput.placeholder = 'Cevabını yaz...';
    }

    // Update example sentence
    const sentenceEl = document.getElementById('example-sentence');
    if (wordData.exampleSentence) {
        sentenceEl.textContent = `"${wordData.exampleSentence}"`;
    } else {
        sentenceEl.textContent = '';
    }

    // Reset UI state
    document.getElementById('answer-input').value = '';
    document.getElementById('answer-input').disabled = false;
    document.getElementById('submit-btn').disabled = false;
    document.getElementById('feedback').classList.add('hidden');
    document.getElementById('correct-answer').classList.add('hidden');
    document.getElementById('next-btn').classList.add('hidden');
    isRetryMode = false;

    // Focus input
    document.getElementById('answer-input').focus();
}

// Submit answer
async function submitAnswer() {
    const input = document.getElementById('answer-input');
    const answer = input.value.trim();

    if (!answer) {
        input.focus();
        return;
    }

    try {
        const response = await fetch('/api/session/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: currentSession.id,
                answer: answer,
                isRetry: isRetryMode
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error);
        }

        // Update stars
        currentSession.stars = data.starsEarned;
        document.getElementById('session-stars').textContent = data.starsEarned;

        // Show feedback
        const feedbackEl = document.getElementById('feedback');
        feedbackEl.classList.remove('hidden', 'correct', 'incorrect', 'almost');

        if (data.result === 'almost' && data.allowRetry) {
            // Allow retry
            feedbackEl.classList.add('almost');
            feedbackEl.querySelector('.feedback-text').textContent = data.message;
            isRetryMode = true;
            input.select();
            return;
        }

        // Disable input
        input.disabled = true;
        document.getElementById('submit-btn').disabled = true;

        if (data.result === 'correct') {
            feedbackEl.classList.add('correct');
            feedbackEl.querySelector('.feedback-text').textContent = 'Doğru! 🎉';
            createSparkle();

            // Check if session is complete
            if (data.isComplete) {
                setTimeout(() => endSession(), 1500);
            } else {
                // Show next button
                document.getElementById('next-btn').classList.remove('hidden');
                document.getElementById('next-btn').focus();

                // Store next word data
                currentSession.nextWord = data.nextWord;
            }
        } else {
            // Wrong answer - show popup
            feedbackEl.classList.add('incorrect');
            feedbackEl.querySelector('.feedback-text').textContent = 'Yanlış 😢';

            // Store next word data before showing popup
            currentSession.nextWord = data.nextWord;
            currentSession.isComplete = data.isComplete;

            // Show popup with both words
            showWrongPopup(currentWordData.english, currentWordData.turkish);
        }

    } catch (error) {
        console.error('Submit answer error:', error);
        alert('Bir hata oluştu: ' + error.message);
    }
}

// Next word
function nextWord() {
    if (currentSession.nextWord) {
        currentSession.currentIndex++;
        displayWord(currentSession.nextWord);
        currentSession.nextWord = null;
    }
}

// End session
async function endSession() {
    try {
        const response = await fetch('/api/session/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSession.id })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error);
        }

        // Display results
        const results = data.results;
        document.getElementById('result-correct').textContent = results.wordsCorrect;
        document.getElementById('result-total').textContent = results.wordsAsked;
        document.getElementById('result-accuracy').textContent = `${results.accuracy}%`;
        document.getElementById('result-stars').textContent = results.starsEarned;

        // Show new achievements
        const achievementsEl = document.getElementById('new-achievements');
        const achievementDisplay = document.getElementById('achievement-display');
        if (results.newAchievements && results.newAchievements.length > 0) {
            achievementsEl.classList.remove('hidden');
            achievementDisplay.innerHTML = results.newAchievements.map(a =>
                `<div>${a.message}</div>`
            ).join('');
        } else {
            achievementsEl.classList.add('hidden');
        }

        // Show all mastered message
        const masteredEl = document.getElementById('all-mastered-message');
        if (results.allMastered) {
            masteredEl.classList.remove('hidden');
        } else {
            masteredEl.classList.add('hidden');
        }

        // Show results screen
        showScreen('results');

        // Trigger confetti
        if (results.accuracy >= 70) {
            createConfetti();
        }

        currentSession = null;

    } catch (error) {
        console.error('End session error:', error);
        alert('Bir hata oluştu: ' + error.message);
    }
}

// Create sparkle effect
function createSparkle() {
    const container = document.querySelector('.question-card');
    for (let i = 0; i < 10; i++) {
        const sparkle = document.createElement('div');
        sparkle.className = 'sparkle';
        sparkle.style.cssText = `
            position: absolute;
            width: 8px;
            height: 8px;
            background: gold;
            border-radius: 50%;
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 100}%;
            animation: sparkleAnim 0.6s ease forwards;
            pointer-events: none;
        `;
        container.appendChild(sparkle);
        setTimeout(() => sparkle.remove(), 600);
    }
}

// Add sparkle animation
const sparkleStyle = document.createElement('style');
sparkleStyle.textContent = `
    @keyframes sparkleAnim {
        0% { transform: scale(0); opacity: 1; }
        100% { transform: scale(2); opacity: 0; }
    }
`;
document.head.appendChild(sparkleStyle);

// Wrong answer popup functions
function showWrongPopup(english, turkish) {
    document.getElementById('popup-english').textContent = english;
    document.getElementById('popup-turkish').textContent = turkish;
    document.getElementById('wrong-answer-popup').classList.remove('hidden');
    isPopupOpen = true;
}

function closeWrongPopup() {
    document.getElementById('wrong-answer-popup').classList.add('hidden');
    isPopupOpen = false;

    // Check if session is complete
    if (currentSession.isComplete) {
        setTimeout(() => endSession(), 500);
    } else {
        // Show next button
        document.getElementById('next-btn').classList.remove('hidden');
        document.getElementById('next-btn').focus();
    }
}

// Render weekly activity tracker
function renderWeeklyTracker(recentActivity) {
    const container = document.getElementById('weekly-boxes');
    const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

    // Get last 7 days (today is rightmost)
    const days = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay();

        // Find activity for this date
        const activity = recentActivity.find(a => a.date === dateStr);
        const sessions = activity ? activity.sessions_completed : 0;

        days.push({
            name: dayNames[dayOfWeek],
            date: dateStr,
            sessions: sessions,
            isToday: i === 0
        });
    }

    container.innerHTML = days.map(day => {
        const stars = day.sessions === 0 ? ''
            : day.sessions === 1 ? '⭐'
            : '⭐⭐';
        const classes = ['day-box'];
        if (day.isToday) classes.push('today');
        if (day.sessions > 0) classes.push('has-activity');

        return `
            <div class="${classes.join(' ')}">
                <div class="day-name">${day.name}</div>
                <div class="day-stars">${stars || '·'}</div>
                <div class="day-count">${day.sessions > 0 ? day.sessions + ' ders' : ''}</div>
            </div>
        `;
    }).join('');
}

// Helper functions
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function getAchievementEmoji(type) {
    if (type.startsWith('mastered_')) return '🏆';
    if (type.startsWith('streak_')) return '🔥';
    return '⭐';
}

function getAchievementLabel(type) {
    if (type.startsWith('mastered_')) {
        const count = type.split('_')[1];
        return `${count} Kelime`;
    }
    if (type.startsWith('streak_')) {
        const days = type.split('_')[1];
        return `${days} Gün Seri`;
    }
    return type;
}

// Make loadDashboard globally accessible for the no-words refresh button
window.loadDashboard = loadDashboard;
