const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function createBackup(db) {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const date = new Date().toISOString().split('T')[0];
    const backupPath = path.join(BACKUP_DIR, `vocab-${date}.db`);

    // Skip if today's backup exists
    if (fs.existsSync(backupPath)) {
        console.log(`Backup already exists: ${backupPath}`);
        return;
    }

    db.backup(backupPath)
        .then(() => {
            console.log(`Backup created: ${backupPath}`);
            cleanupOldBackups();
        })
        .catch(err => console.error('Backup failed:', err));
}

function cleanupOldBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('vocab-') && f.endsWith('.db'))
        .sort()
        .reverse();

    files.slice(MAX_BACKUPS).forEach(f => {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
        console.log(`Deleted old backup: ${f}`);
    });
}

function startBackupScheduler(db) {
    // Run backup on startup
    createBackup(db);

    // Schedule daily backups
    setInterval(() => createBackup(db), DAY_MS);
    console.log('Backup scheduler started (daily)');
}

module.exports = { startBackupScheduler, createBackup };
