-- Vocabulary Trainer Database Schema

-- Words table: stores all vocabulary
CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT NOT NULL UNIQUE,
    turkish TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    example_sentence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Progress table: tracks learning progress per word per direction
CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('en_to_tr', 'tr_to_en')),
    leitner_box INTEGER DEFAULT 0 CHECK (leitner_box >= 0 AND leitner_box <= 5),
    times_asked INTEGER DEFAULT 0,
    times_correct INTEGER DEFAULT 0,
    last_asked DATETIME,
    first_learned DATETIME,
    session_counter INTEGER DEFAULT 0,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    UNIQUE (word_id, direction)
);

-- Sessions table: tracks completed training sessions
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME NOT NULL,
    ended_at DATETIME,
    session_type TEXT NOT NULL CHECK (session_type IN ('quick', 'weak_words', 'review_mastered', 'category')),
    category_filter TEXT DEFAULT 'all',
    words_asked INTEGER DEFAULT 0,
    words_correct INTEGER DEFAULT 0,
    stars_earned INTEGER DEFAULT 0
);

-- Settings table: admin-configurable settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Achievements table: unlocked achievements
CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    data TEXT
);

-- Daily activity table: tracks daily stats
CREATE TABLE IF NOT EXISTS daily_activity (
    date TEXT PRIMARY KEY,
    sessions_completed INTEGER DEFAULT 0,
    words_introduced INTEGER DEFAULT 0,
    stars_earned INTEGER DEFAULT 0
);

-- Learner stats table: cumulative stats (single row)
CREATE TABLE IF NOT EXISTS learner_stats (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_stars INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_active_date TEXT
);

-- Initialize default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('quick_lesson_count', '5'),
    ('weak_words_count', '5'),
    ('new_words_per_day', '5'),
    ('mastered_review_chance', '0.1'),
    ('timezone', 'Europe/Istanbul');

-- Initialize learner stats row
INSERT OR IGNORE INTO learner_stats (id, total_stars, current_streak, longest_streak)
VALUES (1, 0, 0, 0);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_progress_word_id ON progress(word_id);
CREATE INDEX IF NOT EXISTS idx_progress_leitner_box ON progress(leitner_box);
CREATE INDEX IF NOT EXISTS idx_progress_direction ON progress(direction);
CREATE INDEX IF NOT EXISTS idx_words_category ON words(category);
