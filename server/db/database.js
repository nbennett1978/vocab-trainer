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

// Initialize function (kept for compatibility, but schema already loaded)
function initializeDatabase() {
    // Schema already initialized above
}

// Word operations
const wordOperations = {
    getAll: db.prepare(`
        SELECT w.*,
            (SELECT COUNT(*) FROM progress p WHERE p.word_id = w.id AND p.leitner_box = 5) as directions_mastered
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

    getCategoryProgress: db.prepare(`
        SELECT
            w.category,
            COUNT(DISTINCT w.id) as total_words,
            COUNT(DISTINCT CASE
                WHEN p1.leitner_box >= 3 OR p2.leitner_box >= 3 THEN w.id
            END) as mastered_words
        FROM words w
        LEFT JOIN progress p1 ON w.id = p1.word_id AND p1.direction = 'en_to_tr'
        LEFT JOIN progress p2 ON w.id = p2.word_id AND p2.direction = 'tr_to_en'
        GROUP BY w.category
        ORDER BY w.category
    `)
};

// Progress operations
const progressOperations = {
    getByWordId: db.prepare('SELECT * FROM progress WHERE word_id = ?'),

    getByWordAndDirection: db.prepare('SELECT * FROM progress WHERE word_id = ? AND direction = ?'),

    getWordsInBox: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.leitner_box = ? AND p.direction = ?
    `),

    getWordsDueForReview: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.leitner_box > 0
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
        WHERE p.leitner_box = 0 AND p.direction = ?
        ORDER BY w.created_at ASC
    `),

    getMasteredWords: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.leitner_box = 5 AND p.direction = ?
    `),

    getReviewWords: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.leitner_box IN (3, 4, 5) AND p.direction = ?
    `),

    countReviewWords: db.prepare(`
        SELECT COUNT(*) as count
        FROM progress
        WHERE leitner_box IN (3, 4, 5)
    `),

    getWeakWords: db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.leitner_box IN (1, 2) AND p.direction = ?
        AND p.last_asked IS NOT NULL
        ORDER BY p.last_asked DESC
        LIMIT ?
    `),

    insert: db.prepare(`
        INSERT INTO progress (word_id, direction, leitner_box)
        VALUES (@word_id, @direction, @leitner_box)
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

    resetAll: db.prepare('DELETE FROM progress'),

    getStats: db.prepare(`
        SELECT
            direction,
            leitner_box,
            COUNT(*) as count
        FROM progress
        GROUP BY direction, leitner_box
        ORDER BY direction, leitner_box
    `),

    getTotalMastered: db.prepare(`
        SELECT COUNT(DISTINCT word_id) as count
        FROM progress
        WHERE leitner_box = 5
        GROUP BY word_id
        HAVING COUNT(*) = 2
    `)
};

// Session operations
const sessionOperations = {
    insert: db.prepare(`
        INSERT INTO sessions (started_at, session_type, category_filter)
        VALUES (@started_at, @session_type, @category_filter)
    `),

    update: db.prepare(`
        UPDATE sessions
        SET ended_at = @ended_at, words_asked = @words_asked,
            words_correct = @words_correct, stars_earned = @stars_earned
        WHERE id = @id
    `),

    getById: db.prepare('SELECT * FROM sessions WHERE id = ?'),

    getRecent: db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
};

// Settings operations
const settingsOperations = {
    get: db.prepare('SELECT value FROM settings WHERE key = ?'),

    getAll: db.prepare('SELECT * FROM settings'),

    set: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
};

// Daily activity operations
const dailyActivityOperations = {
    getByDate: db.prepare('SELECT * FROM daily_activity WHERE date = ?'),

    upsert: db.prepare(`
        INSERT INTO daily_activity (date, sessions_completed, words_introduced, stars_earned)
        VALUES (@date, @sessions_completed, @words_introduced, @stars_earned)
        ON CONFLICT(date) DO UPDATE SET
            sessions_completed = sessions_completed + @sessions_completed,
            words_introduced = words_introduced + @words_introduced,
            stars_earned = stars_earned + @stars_earned
    `),

    getRecent: db.prepare('SELECT * FROM daily_activity ORDER BY date DESC LIMIT ?')
};

// Learner stats operations
const learnerStatsOperations = {
    get: db.prepare('SELECT * FROM learner_stats WHERE id = 1'),

    update: db.prepare(`
        UPDATE learner_stats
        SET total_stars = @total_stars,
            current_streak = @current_streak,
            longest_streak = @longest_streak,
            last_active_date = @last_active_date
        WHERE id = 1
    `),

    addStars: db.prepare('UPDATE learner_stats SET total_stars = total_stars + ? WHERE id = 1'),

    reset: db.prepare(`
        UPDATE learner_stats
        SET total_stars = 0, current_streak = 0, longest_streak = 0, last_active_date = NULL
        WHERE id = 1
    `)
};

// Achievement operations
const achievementOperations = {
    getAll: db.prepare('SELECT * FROM achievements ORDER BY unlocked_at DESC'),

    getByType: db.prepare('SELECT * FROM achievements WHERE type = ?'),

    insert: db.prepare(`
        INSERT INTO achievements (type, data) VALUES (@type, @data)
    `),

    deleteAll: db.prepare('DELETE FROM achievements')
};

// Helper function to create progress entries for a new word
function createProgressForWord(wordId) {
    progressOperations.insert.run({ word_id: wordId, direction: 'en_to_tr', leitner_box: 0 });
    progressOperations.insert.run({ word_id: wordId, direction: 'tr_to_en', leitner_box: 0 });
}

// Transaction helper
function transaction(fn) {
    return db.transaction(fn)();
}

module.exports = {
    db,
    initializeDatabase,
    wordOperations,
    progressOperations,
    sessionOperations,
    settingsOperations,
    dailyActivityOperations,
    learnerStatsOperations,
    achievementOperations,
    createProgressForWord,
    transaction
};
