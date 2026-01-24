-- Vocabulary Trainer Database Schema (Multi-User)

-- Users table: stores all user accounts
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Words table: stores all vocabulary (shared across users)
-- Note: english is NOT unique to allow multiple meanings (e.g., "to move" can have different Turkish translations)
CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    english TEXT NOT NULL,
    turkish TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    example_sentence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Progress table: tracks learning progress per user per word per direction
CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('en_to_tr', 'tr_to_en')),
    leitner_box INTEGER DEFAULT 0 CHECK (leitner_box >= 0 AND leitner_box <= 5),
    times_asked INTEGER DEFAULT 0,
    times_correct INTEGER DEFAULT 0,
    last_asked DATETIME,
    first_learned DATETIME,
    session_counter INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    UNIQUE (user_id, word_id, direction)
);

-- Sessions table: tracks completed training sessions per user
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    started_at DATETIME NOT NULL,
    ended_at DATETIME,
    session_type TEXT NOT NULL CHECK (session_type IN ('quick', 'weak_words', 'review_mastered', 'category')),
    category_filter TEXT DEFAULT 'all',
    words_asked INTEGER DEFAULT 0,
    words_correct INTEGER DEFAULT 0,
    stars_earned INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Settings table: admin-configurable settings (global)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Achievements table: unlocked achievements per user
CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    data TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, type)
);

-- Daily activity table: tracks daily stats per user
CREATE TABLE IF NOT EXISTS daily_activity (
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    sessions_completed INTEGER DEFAULT 0,
    words_introduced INTEGER DEFAULT 0,
    stars_earned INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Learner stats table: cumulative stats per user
CREATE TABLE IF NOT EXISTS learner_stats (
    user_id INTEGER PRIMARY KEY,
    total_stars INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_active_date TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Initialize default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('quick_lesson_count', '5'),
    ('weak_words_count', '5'),
    ('new_words_per_day', '5'),
    ('mastered_review_chance', '0.1'),
    ('timezone', 'Europe/Istanbul'),
    ('box_1_interval', '1'),
    ('box_2_interval', '1'),
    ('box_3_interval', '1'),
    ('box_4_interval', '8'),
    ('box_5_interval', '16'),
    ('box_1_min_size', '5');

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_user_word ON progress(user_id, word_id);
CREATE INDEX IF NOT EXISTS idx_progress_leitner_box ON progress(leitner_box);
CREATE INDEX IF NOT EXISTS idx_progress_direction ON progress(direction);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_words_category ON words(category);
