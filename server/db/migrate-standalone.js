#!/usr/bin/env node
/**
 * Standalone Migration Script for Multi-User Support
 *
 * Run this BEFORE starting the app when upgrading from single-user version.
 *
 * Usage: node server/db/migrate-standalone.js
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'vocab.db');
const BACKUP_PATH = path.join(DATA_DIR, `vocab.db.backup-${Date.now()}`);

console.log('===========================================');
console.log('Multi-User Migration Script (Standalone)');
console.log('===========================================');
console.log('Database:', DB_PATH);

// Check if database exists
if (!fs.existsSync(DB_PATH)) {
    console.log('No existing database found. Fresh install - no migration needed.');
    console.log('Start the app normally and it will create the database.');
    process.exit(0);
}

// Create backup
console.log('\n1. Creating backup...');
fs.copyFileSync(DB_PATH, BACKUP_PATH);
console.log('   Backup created:', BACKUP_PATH);

// Open database
const db = new Database(DB_PATH);
db.pragma('foreign_keys = OFF'); // Temporarily disable for migration

// Check if already migrated
const hasUsersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
if (hasUsersTable) {
    console.log('\n✓ Database already has users table - migration may have been done.');
    console.log('  Checking if data needs migration...');

    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount > 0) {
        console.log(`  Found ${userCount} users. Migration already complete.`);
        db.close();
        process.exit(0);
    }
}

console.log('\n2. Adding multi-user schema...');

// Create users table
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);
console.log('   ✓ Created users table');

// Check if progress table needs user_id column
const progressInfo = db.prepare("PRAGMA table_info(progress)").all();
const hasUserId = progressInfo.some(col => col.name === 'user_id');

if (!hasUserId) {
    console.log('   Adding user_id to progress table...');
    db.exec('ALTER TABLE progress ADD COLUMN user_id INTEGER DEFAULT 1');
    console.log('   ✓ Added user_id to progress');
}

// Check if sessions table needs user_id column
const sessionsInfo = db.prepare("PRAGMA table_info(sessions)").all();
const sessionsHasUserId = sessionsInfo.some(col => col.name === 'user_id');

if (!sessionsHasUserId) {
    console.log('   Adding user_id to sessions table...');
    db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER DEFAULT 1');
    console.log('   ✓ Added user_id to sessions');
}

// Check if daily_activity table needs user_id column
const dailyInfo = db.prepare("PRAGMA table_info(daily_activity)").all();
const dailyHasUserId = dailyInfo.some(col => col.name === 'user_id');

if (!dailyHasUserId) {
    console.log('   Adding user_id to daily_activity table...');
    db.exec('ALTER TABLE daily_activity ADD COLUMN user_id INTEGER DEFAULT 1');
    console.log('   ✓ Added user_id to daily_activity');
}

// Check if learner_stats table needs user_id column
const statsInfo = db.prepare("PRAGMA table_info(learner_stats)").all();
const statsHasUserId = statsInfo.some(col => col.name === 'user_id');

if (!statsHasUserId) {
    console.log('   Adding user_id to learner_stats table...');
    db.exec('ALTER TABLE learner_stats ADD COLUMN user_id INTEGER DEFAULT 1');
    console.log('   ✓ Added user_id to learner_stats');
}

// Check if achievements table needs user_id column
const achieveInfo = db.prepare("PRAGMA table_info(achievements)").all();
const achieveHasUserId = achieveInfo.some(col => col.name === 'user_id');

if (!achieveHasUserId) {
    console.log('   Adding user_id to achievements table...');
    db.exec('ALTER TABLE achievements ADD COLUMN user_id INTEGER DEFAULT 1');
    console.log('   ✓ Added user_id to achievements');
}

// Rebuild daily_activity table with proper composite primary key
console.log('   Rebuilding daily_activity table with correct primary key...');
db.exec(`
    CREATE TABLE IF NOT EXISTS daily_activity_new (
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        sessions_completed INTEGER DEFAULT 0,
        words_introduced INTEGER DEFAULT 0,
        stars_earned INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, date)
    );
    INSERT OR IGNORE INTO daily_activity_new
        SELECT user_id, date, sessions_completed, words_introduced, stars_earned
        FROM daily_activity;
    DROP TABLE daily_activity;
    ALTER TABLE daily_activity_new RENAME TO daily_activity;
`);
console.log('   ✓ Rebuilt daily_activity table');

// Rebuild learner_stats table with user_id as primary key
console.log('   Rebuilding learner_stats table with correct primary key...');
db.exec(`
    CREATE TABLE IF NOT EXISTS learner_stats_new (
        user_id INTEGER PRIMARY KEY,
        total_stars INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        last_active_date TEXT
    );
    INSERT OR IGNORE INTO learner_stats_new
        SELECT user_id, total_stars, current_streak, longest_streak, last_active_date
        FROM learner_stats;
    DROP TABLE learner_stats;
    ALTER TABLE learner_stats_new RENAME TO learner_stats;
`);
console.log('   ✓ Rebuilt learner_stats table');

console.log('\n3. Recreating indexes...');
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_daily_activity_user ON daily_activity(user_id);
    CREATE INDEX IF NOT EXISTS idx_learner_stats_user ON learner_stats(user_id);
`);
console.log('   ✓ Created indexes');

console.log('\n4. Creating users...');

// Create admin user
const adminPassword = 'admin';
const adminHash = bcrypt.hashSync(adminPassword, 10);
try {
    db.prepare('INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, ?, ?, 1)')
        .run('admin', adminHash);
    console.log('   ✓ Created admin user (password: admin)');
} catch (e) {
    if (e.message.includes('UNIQUE')) {
        console.log('   - Admin user already exists');
    } else {
        throw e;
    }
}

// Create nursi user
const nursiPassword = 'nursi123';
const nursiHash = bcrypt.hashSync(nursiPassword, 10);
try {
    db.prepare('INSERT INTO users (id, username, password_hash, is_admin) VALUES (2, ?, ?, 0)')
        .run('nursi', nursiHash);
    console.log('   ✓ Created nursi user (password: nursi123)');
} catch (e) {
    if (e.message.includes('UNIQUE')) {
        console.log('   - nursi user already exists');
    } else {
        throw e;
    }
}

console.log('\n5. Assigning existing data to nursi (user_id=2)...');

// Update all existing records to belong to nursi (user_id = 2)
const progressUpdate = db.prepare('UPDATE progress SET user_id = 2 WHERE user_id = 1 OR user_id IS NULL').run();
console.log(`   ✓ Updated ${progressUpdate.changes} progress records`);

const sessionsUpdate = db.prepare('UPDATE sessions SET user_id = 2 WHERE user_id = 1 OR user_id IS NULL').run();
console.log(`   ✓ Updated ${sessionsUpdate.changes} session records`);

const dailyUpdate = db.prepare('UPDATE daily_activity SET user_id = 2 WHERE user_id = 1 OR user_id IS NULL').run();
console.log(`   ✓ Updated ${dailyUpdate.changes} daily activity records`);

const statsUpdate = db.prepare('UPDATE learner_stats SET user_id = 2 WHERE user_id = 1 OR user_id IS NULL').run();
console.log(`   ✓ Updated ${statsUpdate.changes} learner stats records`);

const achieveUpdate = db.prepare('UPDATE achievements SET user_id = 2 WHERE user_id = 1 OR user_id IS NULL').run();
console.log(`   ✓ Updated ${achieveUpdate.changes} achievement records`);

// Re-enable foreign keys
db.pragma('foreign_keys = ON');

db.close();

console.log('\n===========================================');
console.log('✓ Migration complete!');
console.log('===========================================');
console.log('\nYou can now start the app with: npm start');
console.log('\nDefault logins:');
console.log('  Admin: admin / admin');
console.log('  Nursi: nursi / nursi123');
console.log('\n⚠️  CHANGE THESE PASSWORDS after first login!');
