// Admin API routes

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const {
    db,
    userOperations,
    wordOperations,
    progressOperations,
    settingsOperations,
    sessionOperations,
    dailyActivityOperations,
    learnerStatsOperations,
    achievementOperations,
    createProgressForWord,
    initializeProgressForUser,
    initializeStatsForUser,
    transaction
} = require('../db/database');
const { getProgressStats, getWorkingSetWithStats, getWorkingSetSuccessRate, getEntireSetWithStats, getWorkingSetSize } = require('../services/leitner');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// All admin routes require authentication and admin privileges
router.use(authenticateToken);
router.use(requireAdmin);

// Configure multer for file uploads
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const upload = multer({
    dest: path.join(DATA_DIR, 'uploads'),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

// Get all users with their stats
router.get('/users', (req, res) => {
    try {
        const users = userOperations.getAll.all();
        const usersWithStats = users.map(user => {
            const stats = learnerStatsOperations.get.get(user.id);
            return {
                id: user.id,
                username: user.username,
                is_admin: user.is_admin ? true : false,
                created_at: user.created_at,
                stats: stats ? {
                    totalStars: stats.total_stars,
                    currentStreak: stats.current_streak,
                    longestStreak: stats.longest_streak,
                    lastActiveDate: stats.last_active_date
                } : null
            };
        });

        res.json({ success: true, users: usersWithStats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a new user
router.post('/users', async (req, res) => {
    try {
        const { username, password, is_admin = false } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required' });
        }

        if (password.length < 4) {
            return res.status(400).json({ success: false, error: 'Password must be at least 4 characters' });
        }

        // Check for duplicate username
        const existing = userOperations.getByUsername.get(username);
        if (existing) {
            return res.status(400).json({ success: false, error: 'Username already exists' });
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Create user
        const result = userOperations.insert.run({
            username: username.trim(),
            password_hash,
            is_admin: is_admin ? 1 : 0
        });

        const userId = result.lastInsertRowid;

        // Initialize progress for the new user
        initializeProgressForUser(userId);
        initializeStatsForUser(userId);

        res.json({
            success: true,
            user: {
                id: userId,
                username: username.trim(),
                is_admin: is_admin ? true : false
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset a user's password
router.put('/users/:id/password', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ success: false, error: 'Password required' });
        }

        if (password.length < 4) {
            return res.status(400).json({ success: false, error: 'Password must be at least 4 characters' });
        }

        const user = userOperations.getById.get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        userOperations.updatePassword.run({ id: userId, password_hash });

        res.json({ success: true, message: 'Password updated' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete a user
router.delete('/users/:id', (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        const user = userOperations.getById.get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Don't allow deleting yourself
        if (userId === req.user.id) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
        }

        // Delete user and all related data (cascade should handle this)
        userOperations.delete.run(userId);

        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get a specific user's progress (for admin viewing student progress)
router.get('/users/:id/progress', (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        const user = userOperations.getById.get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const progressStats = getProgressStats(userId);
        const learnerStats = learnerStatsOperations.get.get(userId);
        const recentActivity = dailyActivityOperations.getRecent.all(userId, 30);
        const recentSessions = sessionOperations.getRecent.all(userId, 20);
        const achievements = achievementOperations.getAll.all(userId);
        const workingSet = getWorkingSetWithStats(userId);

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    username: user.username
                },
                progress: progressStats,
                learner: learnerStats,
                recentActivity,
                recentSessions,
                achievements: achievements.map(a => ({
                    ...a,
                    data: a.data ? JSON.parse(a.data) : null
                })),
                workingSet
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset a user's learning progress
router.post('/users/:id/reset', (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { confirm } = req.body;

        if (confirm !== 'RESET') {
            return res.status(400).json({
                success: false,
                error: 'Please confirm reset by sending { "confirm": "RESET" }'
            });
        }

        const user = userOperations.getById.get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Reset all progress-related data for this user
        progressOperations.resetForUser.run(userId);
        achievementOperations.deleteAll.run(userId);
        learnerStatsOperations.reset.run(userId);

        // Reinitialize progress for all words
        initializeProgressForUser(userId);
        initializeStatsForUser(userId);

        res.json({ success: true, message: `Progress reset for user ${user.username}` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// WORD MANAGEMENT ENDPOINTS
// ============================================

// Get all words (words are shared, no per-user progress needed in list view)
router.get('/words', (req, res) => {
    try {
        const words = wordOperations.getAll.all();
        res.json({ success: true, words });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add a single word
router.post('/words', (req, res) => {
    try {
        const { english, turkish, category, example_sentence } = req.body;

        if (!english || !turkish) {
            return res.status(400).json({ success: false, error: 'English and Turkish are required' });
        }

        // Check for duplicate
        const existing = wordOperations.getByEnglish.get(english.trim());
        if (existing) {
            return res.status(400).json({ success: false, error: 'Word already exists' });
        }

        const result = wordOperations.insert.run({
            english: english.trim(),
            turkish: turkish.trim(),
            category: category || 'other',
            example_sentence: example_sentence || null
        });

        const wordId = result.lastInsertRowid;

        // Create progress entries for ALL users
        const users = userOperations.getAll.all();
        for (const user of users) {
            createProgressForWord(user.id, wordId);
        }

        res.json({
            success: true,
            word: wordOperations.getById.get(wordId)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bulk upload words from text file
router.post('/words/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const content = fs.readFileSync(req.file.path, 'utf-8');

        // Get category from filename (e.g., verbs.txt -> verb)
        let category = req.body.category || 'other';
        if (!req.body.category) {
            const filename = req.file.originalname.toLowerCase();
            if (filename.includes('verb')) category = 'verb';
            else if (filename.includes('noun')) category = 'noun';
            else if (filename.includes('adjective')) category = 'adjective';
            else if (filename.includes('adverb')) category = 'adverb';
        }

        // Parse file content
        const lines = content.split('\n').filter(line => line.trim() && line.includes('#'));
        const results = {
            added: 0,
            skipped: 0,
            errors: []
        };

        // Get all users for progress initialization
        const users = userOperations.getAll.all();

        // Use transaction for bulk insert
        const insertWords = db.transaction(() => {
            for (const line of lines) {
                try {
                    const parts = line.split('#').map(s => s.trim());

                    if (parts.length < 2) {
                        results.errors.push(`Invalid format: ${line}`);
                        continue;
                    }

                    const english = parts[0];
                    const turkish = parts[1];
                    const exampleSentence = parts[2] || null;

                    // Check for duplicate
                    const existing = wordOperations.getByEnglish.get(english);
                    if (existing) {
                        results.skipped++;
                        continue;
                    }

                    const result = wordOperations.insert.run({
                        english,
                        turkish,
                        category,
                        example_sentence: exampleSentence
                    });

                    const wordId = result.lastInsertRowid;

                    // Create progress for ALL users
                    for (const user of users) {
                        createProgressForWord(user.id, wordId);
                    }
                    results.added++;
                } catch (err) {
                    results.errors.push(`Error on line: ${line} - ${err.message}`);
                }
            }
        });

        insertWords();

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update a word
router.put('/words/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { english, turkish, category, example_sentence } = req.body;

        const existing = wordOperations.getById.get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Word not found' });
        }

        // Check for duplicate if english changed
        if (english && english !== existing.english) {
            const duplicate = wordOperations.getByEnglish.get(english.trim());
            if (duplicate && duplicate.id !== id) {
                return res.status(400).json({ success: false, error: 'Word already exists' });
            }
        }

        wordOperations.update.run({
            id,
            english: english?.trim() || existing.english,
            turkish: turkish?.trim() || existing.turkish,
            category: category || existing.category,
            example_sentence: example_sentence !== undefined ? example_sentence : existing.example_sentence
        });

        res.json({
            success: true,
            word: wordOperations.getById.get(id)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete a word
router.delete('/words/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const existing = wordOperations.getById.get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Word not found' });
        }

        wordOperations.delete.run(id);

        // Also delete audio file if it exists
        const audioPath = path.join(DATA_DIR, 'audio', `${id}.mp3`);
        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// AUDIO MANAGEMENT ENDPOINTS
// ============================================

const AUDIO_DIR = path.join(DATA_DIR, 'audio');

// Ensure audio directory exists
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// Check if word has audio
router.get('/words/:id/audio/status', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const audioPath = path.join(AUDIO_DIR, `${id}.mp3`);
        const hasAudio = fs.existsSync(audioPath);
        res.json({ success: true, hasAudio });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get audio status for all words
router.get('/audio/status', (req, res) => {
    try {
        const words = wordOperations.getAll.all();
        const audioStatus = {};
        for (const word of words) {
            const audioPath = path.join(AUDIO_DIR, `${word.id}.mp3`);
            audioStatus[word.id] = fs.existsSync(audioPath);
        }
        res.json({ success: true, audioStatus });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Upload audio for a word (receives base64 audio data)
router.post('/words/:id/audio', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { audioData } = req.body;

        if (!audioData) {
            return res.status(400).json({ success: false, error: 'Audio data required' });
        }

        const existing = wordOperations.getById.get(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Word not found' });
        }

        // Decode base64 and save as MP3
        const audioBuffer = Buffer.from(audioData, 'base64');
        const audioPath = path.join(AUDIO_DIR, `${id}.mp3`);
        fs.writeFileSync(audioPath, audioBuffer);

        res.json({ success: true, message: 'Audio saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete audio for a word
router.delete('/words/:id/audio', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const audioPath = path.join(AUDIO_DIR, `${id}.mp3`);

        if (fs.existsSync(audioPath)) {
            fs.unlinkSync(audioPath);
            res.json({ success: true, message: 'Audio deleted' });
        } else {
            res.json({ success: true, message: 'No audio to delete' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get working set with stats (requires user_id query param)
router.get('/working-set', (req, res) => {
    try {
        const userId = parseInt(req.query.user_id);
        if (!userId) {
            return res.status(400).json({ success: false, error: 'user_id query parameter required' });
        }

        const workingSet = getWorkingSetWithStats(userId);
        const overallSuccessRate = Math.round(getWorkingSetSuccessRate(userId) * 100);

        // Sort by success rate (ascending) - words with lowest success first
        workingSet.sort((a, b) => {
            // Words with no attempts go to the end
            if (a.successRatePercent === null && b.successRatePercent === null) return 0;
            if (a.successRatePercent === null) return 1;
            if (b.successRatePercent === null) return -1;
            return a.successRatePercent - b.successRatePercent;
        });

        res.json({
            success: true,
            data: {
                words: workingSet,
                count: workingSet.length,
                overallSuccessRate
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get entire set with stats (requires user_id query param)
router.get('/entire-set', (req, res) => {
    try {
        const userId = parseInt(req.query.user_id);
        if (!userId) {
            return res.status(400).json({ success: false, error: 'user_id query parameter required' });
        }

        const entireSet = getEntireSetWithStats(userId);
        const workingSetSize = getWorkingSetSize(userId);
        const notStarted = entireSet.filter(w => w.en_to_tr.box === 0 && w.tr_to_en.box === 0).length;

        // Sort by success rate (ascending) - words with lowest success first
        entireSet.sort((a, b) => {
            // Words with no attempts go to the end
            if (a.successRatePercent === null && b.successRatePercent === null) return 0;
            if (a.successRatePercent === null) return 1;
            if (b.successRatePercent === null) return -1;
            return a.successRatePercent - b.successRatePercent;
        });

        res.json({
            success: true,
            data: {
                words: entireSet,
                count: entireSet.length,
                inWorkingSet: workingSetSize,
                notStarted: notStarted
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get progress for a specific user
router.get('/progress', (req, res) => {
    try {
        const userId = req.query.user_id ? parseInt(req.query.user_id) : null;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'user_id is required' });
        }

        const user = userOperations.getById.get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const stats = learnerStatsOperations.get.get(userId);
        const progressStats = getProgressStats(userId);
        const recentSessions = sessionOperations.getRecent.all(userId, 20);
        const achievements = db.prepare('SELECT * FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC').all(userId);

        res.json({
            success: true,
            data: {
                progress: progressStats,
                learner: stats || {
                    total_stars: 0,
                    current_streak: 0,
                    longest_streak: 0,
                    last_active_date: null
                },
                recentSessions,
                achievements
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset all learning progress for ALL users
router.post('/reset', (req, res) => {
    try {
        const { confirm } = req.body;

        if (confirm !== 'RESET_ALL') {
            return res.status(400).json({
                success: false,
                error: 'Please confirm reset by sending { "confirm": "RESET_ALL" }. Use /users/:id/reset to reset a single user.'
            });
        }

        // Reset all progress-related tables for all users
        db.exec(`
            DELETE FROM progress;
            DELETE FROM sessions;
            DELETE FROM daily_activity;
            DELETE FROM achievements;
            DELETE FROM learner_stats;
        `);

        // Recreate progress entries for all words and all users
        const words = wordOperations.getAll.all();
        const users = userOperations.getAll.all();

        for (const user of users) {
            initializeStatsForUser(user.id);
            for (const word of words) {
                createProgressForWord(user.id, word.id);
            }
        }

        res.json({ success: true, message: 'All progress has been reset for all users' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get settings
router.get('/settings', (req, res) => {
    try {
        const settings = settingsOperations.getAll.all();
        const settingsObj = {};
        for (const s of settings) {
            settingsObj[s.key] = s.value;
        }
        res.json({ success: true, settings: settingsObj });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update settings
router.put('/settings', (req, res) => {
    try {
        const allowedKeys = [
            'quick_lesson_count', 'weak_words_count', 'mastered_review_chance',
            'timezone', 'answer_timeout',
            'box_1_interval', 'box_2_interval', 'box_3_interval',
            'box_4_interval', 'box_5_interval', 'box_1_min_size'
        ];

        for (const [key, value] of Object.entries(req.body)) {
            if (allowedKeys.includes(key)) {
                settingsOperations.set.run(key, String(value));
            }
        }

        const settings = settingsOperations.getAll.all();
        const settingsObj = {};
        for (const s of settings) {
            settingsObj[s.key] = s.value;
        }

        res.json({ success: true, settings: settingsObj });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
