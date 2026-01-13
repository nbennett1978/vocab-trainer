const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'vocab.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database connection
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema FIRST before preparing any statements
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);
console.log('Database initialized successfully');

// Initialize function (kept for compatibility)
function initializeDatabase() {
    // Schema already initialized above
}

// ============================================
// USER OPERATIONS
// ============================================
const userOperations = {
    getAll: db.prepare(`
        SELECT id, username, is_admin, created_at, updated_at
        FROM users
        ORDER BY created_at DESC
    `),

    getById: db.prepare('SELECT * FROM users WHERE id = ?'),

    getByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),

    insert: db.prepare(`
        INSERT INTO users (username, password_hash, is_admin)
        VALUES (@username, @password_hash, @is_admin)
    `),

    updatePassword: db.prepare(`
        UPDATE users
        SET password_hash = @password_hash, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
    `),

    updateUsername: db.prepare(`
        UPDATE users
        SET username = @username, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
    `),

    delete: db.prepare('DELETE FROM users WHERE id = ?'),

    count: db.prepare('SELECT COUNT(*) as count FROM users'),

    // Get all users with their stats for leaderboard
    getLeaderboard: db.prepare(`
        SELECT
            u.id,
            u.username,
            COALESCE(ls.total_stars, 0) as total_stars,
            COALESCE(ls.current_streak, 0) as current_streak,
            COALESCE(ls.longest_streak, 0) as longest_streak
        FROM users u
        LEFT JOIN learner_stats ls ON u.id = ls.user_id
        WHERE u.is_admin = 0
        ORDER BY ls.total_stars DESC, ls.current_streak DESC
    `),

    // Get user with stats
    getWithStats: db.prepare(`
        SELECT
            u.id,
            u.username,
            u.is_admin,
            u.created_at,
            COALESCE(ls.total_stars, 0) as total_stars,
            COALESCE(ls.current_streak, 0) as current_streak,
            COALESCE(ls.longest_streak, 0) as longest_streak,
            ls.last_active_date
        FROM users u
        LEFT JOIN learner_stats ls ON u.id = ls.user_id
        WHERE u.id = ?
    `)
};

// ============================================
// WORD OPERATIONS (shared across users)
// ============================================
const wordOperations = {
    getAll: db.prepare(`
        SELECT * FROM words
        ORDER BY created_at DESC
    `),

    // Get all words with progress for a specific user
    getAllWithProgress: db.prepare(`
        SELECT w.*,
            (SELECT COUNT(*) FROM progress p WHERE p.word_id = w.id AND p.user_id = ? AND p.leitner_box >= 3) as directions_mastered
        FROM words w
        ORDER BY w.created_at DESC
    `),

    getById: db.prepare('SELECT * FROM words WHERE id = ?'),

    getByEnglish: db.prepare('SELECT * FROM words WHERE english = ?'),

    getByCategory: db.prepare('SELECT * FROM words WHERE category = ?'),

    getCategories: db.prepare('SELECT DISTINCT category FROM words ORDER BY category'),

    getCategoriesWithCounts: db.prepare(`
        SELECT
            w.category,
            COUNT(DISTINCT w.id) as word_count
        FROM words w
        GROUP BY w.category
        ORDER BY w.category
    `),

    insert: db.prepare(`
        INSERT INTO words (english, turkish, category, example_sentence)
        VALUES (@english, @turkish, @category, @example_sentence)
    `),

    update: db.prepare(`
        UPDATE words
        SET english = @english, turkish = @turkish, category = @category, example_sentence = @example_sentence
        WHERE id = @id
    `),

    delete: db.prepare('DELETE FROM words WHERE id = ?'),

    count: db.prepare('SELECT COUNT(*) as count FROM words'),

    countByCategory: db.prepare('SELECT category, COUNT(*) as count FROM words GROUP BY category'),

    // Category progress per user
    getCategoryProgress: db.prepare(`
        SELECT
            w.category,
            COUNT(DISTINCT w.id) as total_words,
            COUNT(DISTINCT CASE
                WHEN p1.leitner_box >= 3 OR p2.leitner_box >= 3 THEN w.id
            END) as mastered_words
        FROM words w
        LEFT JOIN progress p1 ON w.id = p1.word_id AND p1.direction = 'en_to_tr' AND p1.user_id = ?
        LEFT JOIN progress p2 ON w.id = p2.word_id AND p2.direction = 'tr_to_en' AND p2.user_id = ?
        GROUP BY w.category
        ORDER BY w.category
    `)
};

// ============================================
// PROGRESS OPERATIONS (per user)
// ============================================
const progressOperations = {
    getByWordId: db.prepare('SELECT * FROM progress WHERE user_id = ? AND word_id = ?'),

    getByWordAndDirection: db.prepare('SELECT * FROM progress WHERE user_id = ? AND word_id = ? AND direction = ?'),

    getWordsInBox: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.user_id = ? AND p.leitner_box = ? AND p.direction = ?
    `),

    getWordsDueForReview: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.user_id = ? AND p.leitner_box > 0
        AND p.direction = ?
        AND (
            (p.leitner_box = 1) OR
            (p.leitner_box = 2 AND p.session_counter % 2 = 0) OR
            (p.leitner_box = 3 AND p.session_counter % 4 = 0) OR
            (p.leitner_box = 4 AND p.session_counter % 8 = 0) OR
            (p.leitner_box = 5)
        )
        ORDER BY p.leitner_box ASC, p.last_asked ASC
    `),

    getNewWords: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.user_id = ? AND p.leitner_box = 0 AND p.direction = ?
        ORDER BY w.created_at ASC
    `),

    getMasteredWords: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.user_id = ? AND p.leitner_box >= 3 AND p.direction = ?
    `),

    getReviewWords: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.user_id = ? AND p.leitner_box IN (3, 4, 5) AND p.direction = ?
    `),

    countReviewWords: db.prepare(`
        SELECT COUNT(*) as count
        FROM progress
        WHERE user_id = ? AND leitner_box IN (3, 4, 5)
    `),

    getWeakWords: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.user_id = ? AND p.leitner_box IN (1, 2) AND p.direction = ?
        AND p.last_asked IS NOT NULL
        ORDER BY p.last_asked DESC
        LIMIT ?
    `),

    countBox1Words: db.prepare(`
        SELECT COUNT(*) as count
        FROM progress
        WHERE user_id = ? AND direction = ? AND leitner_box = 1
    `),

    insert: db.prepare(`
        INSERT INTO progress (user_id, word_id, direction, leitner_box)
        VALUES (@user_id, @word_id, @direction, @leitner_box)
    `),

    updateAfterAnswer: db.prepare(`
        UPDATE progress
        SET leitner_box = @leitner_box,
            times_asked = times_asked + 1,
            times_correct = times_correct + @correct,
            last_asked = @last_asked,
            first_learned = COALESCE(first_learned, @first_learned),
            session_counter = session_counter + 1
        WHERE id = @id
    `),

    resetForUser: db.prepare('DELETE FROM progress WHERE user_id = ?'),

    getStats: db.prepare(`
        SELECT
            direction,
            leitner_box,
            COUNT(*) as count
        FROM progress
        WHERE user_id = ?
        GROUP BY direction, leitner_box
        ORDER BY direction, leitner_box
    `),

    getTotalMastered: db.prepare(`
        SELECT COUNT(*) as count FROM (
            SELECT word_id
            FROM progress
            WHERE user_id = ? AND leitner_box >= 3
            GROUP BY word_id
            HAVING COUNT(*) = 2
        )
    `),

    // Get all progress for a user (for working set display)
    getWorkingSet: db.prepare(`
        SELECT
            w.id as word_id,
            w.english,
            w.turkish,
            w.category,
            p1.leitner_box as en_to_tr_box,
            p1.times_asked as en_to_tr_asked,
            p1.times_correct as en_to_tr_correct,
            p2.leitner_box as tr_to_en_box,
            p2.times_asked as tr_to_en_asked,
            p2.times_correct as tr_to_en_correct
        FROM words w
        LEFT JOIN progress p1 ON w.id = p1.word_id AND p1.direction = 'en_to_tr' AND p1.user_id = ?
        LEFT JOIN progress p2 ON w.id = p2.word_id AND p2.direction = 'tr_to_en' AND p2.user_id = ?
        WHERE (p1.leitner_box > 0 OR p2.leitner_box > 0)
        ORDER BY w.english
    `),

    // Get entire set with progress for user
    getEntireSet: db.prepare(`
        SELECT
            w.id as word_id,
            w.english,
            w.turkish,
            w.category,
            COALESCE(p1.leitner_box, 0) as en_to_tr_box,
            COALESCE(p1.times_asked, 0) as en_to_tr_asked,
            COALESCE(p1.times_correct, 0) as en_to_tr_correct,
            COALESCE(p2.leitner_box, 0) as tr_to_en_box,
            COALESCE(p2.times_asked, 0) as tr_to_en_asked,
            COALESCE(p2.times_correct, 0) as tr_to_en_correct
        FROM words w
        LEFT JOIN progress p1 ON w.id = p1.word_id AND p1.direction = 'en_to_tr' AND p1.user_id = ?
        LEFT JOIN progress p2 ON w.id = p2.word_id AND p2.direction = 'tr_to_en' AND p2.user_id = ?
        ORDER BY w.english
    `)
};

// ============================================
// SESSION OPERATIONS (per user)
// ============================================
const sessionOperations = {
    insert: db.prepare(`
        INSERT INTO sessions (user_id, started_at, session_type, category_filter)
        VALUES (@user_id, @started_at, @session_type, @category_filter)
    `),

    update: db.prepare(`
        UPDATE sessions
        SET ended_at = @ended_at, words_asked = @words_asked,
            words_correct = @words_correct, stars_earned = @stars_earned
        WHERE id = @id
    `),

    getById: db.prepare('SELECT * FROM sessions WHERE id = ?'),

    getRecent: db.prepare('SELECT * FROM sessions WHERE user_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?'),

    getRecentAll: db.prepare('SELECT s.*, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.ended_at IS NOT NULL ORDER BY s.started_at DESC LIMIT ?'),

    // Get incomplete sessions (for cleanup/recovery)
    getIncomplete: db.prepare('SELECT * FROM sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC'),

    // Mark orphaned sessions as abandoned
    abandonOrphaned: db.prepare(`
        UPDATE sessions
        SET ended_at = CURRENT_TIMESTAMP
        WHERE ended_at IS NULL AND started_at < datetime('now', '-2 hours')
    `)
};

// ============================================
// SETTINGS OPERATIONS (global)
// ============================================
const settingsOperations = {
    get: db.prepare('SELECT value FROM settings WHERE key = ?'),

    getAll: db.prepare('SELECT * FROM settings'),

    set: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
};

// ============================================
// DAILY ACTIVITY OPERATIONS (per user)
// ============================================
const dailyActivityOperations = {
    getByDate: db.prepare('SELECT * FROM daily_activity WHERE user_id = ? AND date = ?'),

    upsert: db.prepare(`
        INSERT INTO daily_activity (user_id, date, sessions_completed, words_introduced, stars_earned)
        VALUES (@user_id, @date, @sessions_completed, @words_introduced, @stars_earned)
        ON CONFLICT(user_id, date) DO UPDATE SET
            sessions_completed = sessions_completed + @sessions_completed,
            words_introduced = words_introduced + @words_introduced,
            stars_earned = stars_earned + @stars_earned
    `),

    getRecent: db.prepare('SELECT * FROM daily_activity WHERE user_id = ? ORDER BY date DESC LIMIT ?')
};

// ============================================
// LEARNER STATS OPERATIONS (per user)
// ============================================
const learnerStatsOperations = {
    get: db.prepare('SELECT * FROM learner_stats WHERE user_id = ?'),

    upsert: db.prepare(`
        INSERT INTO learner_stats (user_id, total_stars, current_streak, longest_streak, last_active_date)
        VALUES (@user_id, @total_stars, @current_streak, @longest_streak, @last_active_date)
        ON CONFLICT(user_id) DO UPDATE SET
            total_stars = @total_stars,
            current_streak = @current_streak,
            longest_streak = @longest_streak,
            last_active_date = @last_active_date
    `),

    addStars: db.prepare(`
        INSERT INTO learner_stats (user_id, total_stars, current_streak, longest_streak)
        VALUES (@user_id, @stars, 0, 0)
        ON CONFLICT(user_id) DO UPDATE SET
            total_stars = total_stars + @stars
    `),

    reset: db.prepare(`
        DELETE FROM learner_stats WHERE user_id = ?
    `)
};

// ============================================
// ACHIEVEMENT OPERATIONS (per user)
// ============================================
const achievementOperations = {
    getAll: db.prepare('SELECT * FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC'),

    getByType: db.prepare('SELECT * FROM achievements WHERE user_id = ? AND type = ?'),

    insert: db.prepare(`
        INSERT OR IGNORE INTO achievements (user_id, type, data) VALUES (@user_id, @type, @data)
    `),

    deleteAll: db.prepare('DELETE FROM achievements WHERE user_id = ?')
};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Create progress entries for a new word for a specific user
function createProgressForWord(userId, wordId) {
    progressOperations.insert.run({ user_id: userId, word_id: wordId, direction: 'en_to_tr', leitner_box: 0 });
    progressOperations.insert.run({ user_id: userId, word_id: wordId, direction: 'tr_to_en', leitner_box: 0 });
}

// Create progress entries for all words for a new user
function initializeProgressForUser(userId) {
    const words = wordOperations.getAll.all();
    const insertProgress = db.prepare(`
        INSERT OR IGNORE INTO progress (user_id, word_id, direction, leitner_box)
        VALUES (?, ?, ?, 0)
    `);

    const insertMany = db.transaction((userId, words) => {
        for (const word of words) {
            insertProgress.run(userId, word.id, 'en_to_tr');
            insertProgress.run(userId, word.id, 'tr_to_en');
        }
    });

    insertMany(userId, words);
}

// Initialize learner stats for a new user
function initializeStatsForUser(userId) {
    learnerStatsOperations.upsert.run({
        user_id: userId,
        total_stars: 0,
        current_streak: 0,
        longest_streak: 0,
        last_active_date: null
    });
}

// Transaction helper
function transaction(fn) {
    return db.transaction(fn)();
}

module.exports = {
    db,
    initializeDatabase,
    userOperations,
    wordOperations,
    progressOperations,
    sessionOperations,
    settingsOperations,
    dailyActivityOperations,
    learnerStatsOperations,
    achievementOperations,
    createProgressForWord,
    initializeProgressForUser,
    initializeStatsForUser,
    transaction
};
