/**
 * Migration Script: Single-User to Multi-User
 *
 * This script migrates the vocab-trainer database from single-user to multi-user.
 * It creates:
 * - users table
 * - admin user (password from config or default 'admin')
 * - nursi user (migrates all existing progress)
 *
 * Run with: npm run migrate
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'vocab.db');
const BACKUP_PATH = path.join(DATA_DIR, `vocab.db.backup-${Date.now()}`);
const CONFIG_PATH = path.join(__dirname, '../../config/admin.json');

const SALT_ROUNDS = 10;

// Load admin password from config or use default
function getAdminPassword() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            return config.adminPassword || 'admin';
        }
    } catch (e) {
        console.log('No config file found, using default admin password');
    }
    return 'admin';
}

async function migrate() {
    console.log('='.repeat(60));
    console.log('Multi-User Migration Script');
    console.log('='.repeat(60));

    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
        console.log('No existing database found. Fresh install will create multi-user schema.');
        process.exit(0);
    }

    // Create backup
    console.log(`\n[1/8] Creating backup at ${BACKUP_PATH}...`);
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    console.log('      Backup created successfully.');

    // Open database
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = OFF'); // Temporarily disable for migration

    try {
        // Check if already migrated
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
        if (tables) {
            console.log('\n[!] Database already has users table. Migration may have already run.');
            const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
            console.log(`    Found ${userCount.count} users in database.`);

            // Check if we should continue
            const progressHasUserId = db.prepare("PRAGMA table_info(progress)").all()
                .some(col => col.name === 'user_id');

            if (progressHasUserId) {
                console.log('    Migration appears complete. Exiting.');
                process.exit(0);
            } else {
                console.log('    Users table exists but progress not migrated. Continuing...');
            }
        }

        // Start transaction
        db.exec('BEGIN TRANSACTION');

        // Create users table
        console.log('\n[2/8] Creating users table...');
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('      Users table created.');

        // Create admin user
        console.log('\n[3/8] Creating admin user...');
        const adminPassword = getAdminPassword();
        const adminHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

        const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
        if (!existingAdmin) {
            db.prepare(`
                INSERT INTO users (username, password_hash, is_admin)
                VALUES (?, ?, 1)
            `).run('admin', adminHash);
            console.log('      Admin user created.');
        } else {
            console.log('      Admin user already exists.');
        }

        // Create nursi user and get ID
        console.log('\n[4/8] Creating nursi user...');
        const nursiPassword = await bcrypt.hash('nursi123', SALT_ROUNDS);

        let nursiId;
        const existingNursi = db.prepare('SELECT id FROM users WHERE username = ?').get('nursi');
        if (!existingNursi) {
            const result = db.prepare(`
                INSERT INTO users (username, password_hash, is_admin)
                VALUES (?, ?, 0)
            `).run('nursi', nursiPassword);
            nursiId = result.lastInsertRowid;
            console.log(`      Nursi user created with ID ${nursiId}.`);
        } else {
            nursiId = existingNursi.id;
            console.log(`      Nursi user already exists with ID ${nursiId}.`);
        }

        // Migrate progress table
        console.log('\n[5/8] Migrating progress table...');

        // Check if progress has user_id
        const progressCols = db.prepare("PRAGMA table_info(progress)").all();
        const hasUserId = progressCols.some(col => col.name === 'user_id');

        if (!hasUserId) {
            // Get existing progress data
            const existingProgress = db.prepare('SELECT * FROM progress').all();
            console.log(`      Found ${existingProgress.length} progress records to migrate.`);

            // Drop and recreate progress table with user_id
            db.exec('DROP TABLE IF EXISTS progress');
            db.exec(`
                CREATE TABLE progress (
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
                )
            `);

            // Reinsert with user_id
            const insertProgress = db.prepare(`
                INSERT INTO progress (user_id, word_id, direction, leitner_box, times_asked, times_correct, last_asked, first_learned, session_counter)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const p of existingProgress) {
                insertProgress.run(nursiId, p.word_id, p.direction, p.leitner_box, p.times_asked, p.times_correct, p.last_asked, p.first_learned, p.session_counter);
            }
            console.log(`      Migrated ${existingProgress.length} progress records to nursi.`);
        } else {
            console.log('      Progress table already has user_id column.');
        }

        // Migrate sessions table
        console.log('\n[6/8] Migrating sessions table...');
        const sessionCols = db.prepare("PRAGMA table_info(sessions)").all();
        const sessionsHasUserId = sessionCols.some(col => col.name === 'user_id');

        if (!sessionsHasUserId) {
            const existingSessions = db.prepare('SELECT * FROM sessions').all();
            console.log(`      Found ${existingSessions.length} sessions to migrate.`);

            db.exec('DROP TABLE IF EXISTS sessions');
            db.exec(`
                CREATE TABLE sessions (
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
                )
            `);

            const insertSession = db.prepare(`
                INSERT INTO sessions (user_id, started_at, ended_at, session_type, category_filter, words_asked, words_correct, stars_earned)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const s of existingSessions) {
                insertSession.run(nursiId, s.started_at, s.ended_at, s.session_type, s.category_filter, s.words_asked, s.words_correct, s.stars_earned);
            }
            console.log(`      Migrated ${existingSessions.length} sessions to nursi.`);
        } else {
            console.log('      Sessions table already has user_id column.');
        }

        // Migrate achievements table
        console.log('\n[7/8] Migrating achievements and stats...');
        const achievementCols = db.prepare("PRAGMA table_info(achievements)").all();
        const achievementsHasUserId = achievementCols.some(col => col.name === 'user_id');

        if (!achievementsHasUserId) {
            const existingAchievements = db.prepare('SELECT * FROM achievements').all();

            db.exec('DROP TABLE IF EXISTS achievements');
            db.exec(`
                CREATE TABLE achievements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    data TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE (user_id, type)
                )
            `);

            const insertAchievement = db.prepare(`
                INSERT OR IGNORE INTO achievements (user_id, type, unlocked_at, data)
                VALUES (?, ?, ?, ?)
            `);

            for (const a of existingAchievements) {
                insertAchievement.run(nursiId, a.type, a.unlocked_at, a.data);
            }
            console.log(`      Migrated ${existingAchievements.length} achievements to nursi.`);
        }

        // Migrate daily_activity table
        const dailyCols = db.prepare("PRAGMA table_info(daily_activity)").all();
        const dailyHasUserId = dailyCols.some(col => col.name === 'user_id');

        if (!dailyHasUserId) {
            const existingDaily = db.prepare('SELECT * FROM daily_activity').all();

            db.exec('DROP TABLE IF EXISTS daily_activity');
            db.exec(`
                CREATE TABLE daily_activity (
                    user_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    sessions_completed INTEGER DEFAULT 0,
                    words_introduced INTEGER DEFAULT 0,
                    stars_earned INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, date),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            const insertDaily = db.prepare(`
                INSERT INTO daily_activity (user_id, date, sessions_completed, words_introduced, stars_earned)
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const d of existingDaily) {
                insertDaily.run(nursiId, d.date, d.sessions_completed, d.words_introduced, d.stars_earned);
            }
            console.log(`      Migrated ${existingDaily.length} daily activity records to nursi.`);
        }

        // Migrate learner_stats table
        const statsCols = db.prepare("PRAGMA table_info(learner_stats)").all();
        const statsHasUserId = statsCols.some(col => col.name === 'user_id');

        if (!statsHasUserId) {
            const existingStats = db.prepare('SELECT * FROM learner_stats WHERE id = 1').get();

            db.exec('DROP TABLE IF EXISTS learner_stats');
            db.exec(`
                CREATE TABLE learner_stats (
                    user_id INTEGER PRIMARY KEY,
                    total_stars INTEGER DEFAULT 0,
                    current_streak INTEGER DEFAULT 0,
                    longest_streak INTEGER DEFAULT 0,
                    last_active_date TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            if (existingStats) {
                db.prepare(`
                    INSERT INTO learner_stats (user_id, total_stars, current_streak, longest_streak, last_active_date)
                    VALUES (?, ?, ?, ?, ?)
                `).run(nursiId, existingStats.total_stars, existingStats.current_streak, existingStats.longest_streak, existingStats.last_active_date);
                console.log(`      Migrated learner stats to nursi (${existingStats.total_stars} stars, ${existingStats.current_streak} streak).`);
            }
        }

        // Create indexes
        console.log('\n[8/8] Creating indexes...');
        db.exec('CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_progress_user_word ON progress(user_id, word_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_progress_leitner_box ON progress(leitner_box)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_progress_direction ON progress(direction)');
        console.log('      Indexes created.');

        // Commit transaction
        db.exec('COMMIT');
        db.pragma('foreign_keys = ON');

        console.log('\n' + '='.repeat(60));
        console.log('Migration completed successfully!');
        console.log('='.repeat(60));
        console.log('\nUsers created:');
        console.log('  - admin (password: ' + (adminPassword === 'admin' ? 'admin [DEFAULT - CHANGE IN PRODUCTION]' : '[from config]') + ')');
        console.log('  - nursi (password: nursi123)');
        console.log('\nAll existing progress has been migrated to user "nursi".');
        console.log(`Backup saved at: ${BACKUP_PATH}`);

    } catch (error) {
        console.error('\n[ERROR] Migration failed:', error.message);
        console.log('Rolling back...');
        try {
            db.exec('ROLLBACK');
        } catch (e) {
            // Ignore rollback errors
        }
        console.log(`Restoring from backup: ${BACKUP_PATH}`);
        fs.copyFileSync(BACKUP_PATH, DB_PATH);
        console.log('Database restored from backup.');
        process.exit(1);
    } finally {
        db.close();
    }
}

// Run migration
migrate().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
});
