// Database migrations
// Migrations run automatically at startup if not already applied

const migrations = [
    {
        id: 1,
        name: 'remove_unique_constraint_from_english',
        description: 'Allow duplicate English words with different meanings/translations',
        run: (db) => {
            // Check if the UNIQUE constraint exists on english column
            const tableInfo = db.prepare("PRAGMA table_info(words)").all();
            const indexList = db.prepare("PRAGMA index_list(words)").all();

            // Find if there's a unique index on english
            const hasUniqueEnglish = indexList.some(idx => {
                if (!idx.unique) return false;
                const indexInfo = db.prepare(`PRAGMA index_info(${idx.name})`).all();
                return indexInfo.length === 1 && indexInfo[0].name === 'english';
            });

            // Also check for inline UNIQUE constraint by trying to find sqlite_autoindex
            const hasAutoIndex = indexList.some(idx =>
                idx.name.includes('sqlite_autoindex') && idx.unique
            );

            if (!hasUniqueEnglish && !hasAutoIndex) {
                console.log('Migration 1: UNIQUE constraint already removed or never existed');
                return;
            }

            console.log('Migration 1: Removing UNIQUE constraint from english column...');

            // SQLite doesn't support ALTER TABLE DROP CONSTRAINT
            // We need to recreate the table carefully
            // CRITICAL: Must backup and restore progress to avoid CASCADE deletes

            // Step 1: Disable foreign keys
            db.pragma('foreign_keys = OFF');

            // Step 2: Backup progress data FIRST (before any table changes)
            console.log('  - Backing up progress data...');
            const progressData = db.prepare('SELECT * FROM progress').all();
            console.log(`  - Found ${progressData.length} progress records`);

            // Step 3: Backup words data
            console.log('  - Backing up words data...');
            const wordsData = db.prepare('SELECT * FROM words').all();
            console.log(`  - Found ${wordsData.length} words`);

            // Step 4: Drop old words table and recreate without UNIQUE constraint
            console.log('  - Recreating words table without UNIQUE constraint...');
            db.exec('DROP TABLE IF EXISTS words');
            db.exec(`
                CREATE TABLE words (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    english TEXT NOT NULL,
                    turkish TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'other',
                    example_sentence TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Step 5: Restore words data
            console.log('  - Restoring words data...');
            const insertWord = db.prepare(`
                INSERT INTO words (id, english, turkish, category, example_sentence, created_at)
                VALUES (@id, @english, @turkish, @category, @example_sentence, @created_at)
            `);
            for (const word of wordsData) {
                insertWord.run(word);
            }
            console.log(`  - Restored ${wordsData.length} words`);

            // Step 6: Check and restore progress if needed
            const remainingProgress = db.prepare('SELECT COUNT(*) as count FROM progress').get();
            if (remainingProgress.count === 0 && progressData.length > 0) {
                console.log('  - Progress was deleted by CASCADE, restoring...');
                const insertProgress = db.prepare(`
                    INSERT INTO progress (id, user_id, word_id, direction, leitner_box, times_asked, times_correct, last_asked, first_learned, session_counter)
                    VALUES (@id, @user_id, @word_id, @direction, @leitner_box, @times_asked, @times_correct, @last_asked, @first_learned, @session_counter)
                `);
                for (const row of progressData) {
                    insertProgress.run(row);
                }
                console.log(`  - Restored ${progressData.length} progress records`);
            } else {
                console.log(`  - Progress intact: ${remainingProgress.count} records`);
            }

            // Step 7: Recreate index
            db.exec('CREATE INDEX IF NOT EXISTS idx_words_category ON words(category)');

            // Step 8: Re-enable foreign keys
            db.pragma('foreign_keys = ON');

            console.log('Migration 1: Successfully removed UNIQUE constraint from english column');
        }
    }
];

// Create migrations tracking table if it doesn't exist
function initMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

// Get list of applied migration IDs
function getAppliedMigrations(db) {
    const rows = db.prepare('SELECT id FROM migrations').all();
    return new Set(rows.map(r => r.id));
}

// Mark a migration as applied
function markMigrationApplied(db, migration) {
    db.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)').run(migration.id, migration.name);
}

// Run all pending migrations
function runMigrations(db) {
    initMigrationsTable(db);

    const applied = getAppliedMigrations(db);
    let migrationsRun = 0;

    for (const migration of migrations) {
        if (applied.has(migration.id)) {
            continue;
        }

        console.log(`Running migration ${migration.id}: ${migration.name}`);

        try {
            // Run migration (NOT in a transaction - schema changes don't work well in transactions)
            migration.run(db);
            markMigrationApplied(db, migration);
            migrationsRun++;
            console.log(`Migration ${migration.id} completed successfully`);
        } catch (error) {
            console.error(`Migration ${migration.id} failed:`, error);
            throw error;
        }
    }

    if (migrationsRun > 0) {
        console.log(`${migrationsRun} migration(s) applied successfully`);
    }

    return migrationsRun;
}

module.exports = {
    runMigrations,
    migrations
};
