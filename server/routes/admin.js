// Admin API routes

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

const {
    db,
    wordOperations,
    progressOperations,
    settingsOperations,
    sessionOperations,
    dailyActivityOperations,
    learnerStatsOperations,
    achievementOperations,
    createProgressForWord,
    transaction
} = require('../db/database');
const { getProgressStats, getWorkingSetWithStats, getWorkingSetSuccessRate, getEntireSetWithStats, getWorkingSetSize } = require('../services/leitner');

// Configure multer for file uploads
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const upload = multer({
    dest: path.join(DATA_DIR, 'uploads'),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Get all words with progress summary
router.get('/words', (req, res) => {
    try {
        const words = wordOperations.getAll.all();

        // Get progress for each word
        const wordsWithProgress = words.map(word => {
            const progress = progressOperations.getByWordId.all(word.id);
            const enToTr = progress.find(p => p.direction === 'en_to_tr');
            const trToEn = progress.find(p => p.direction === 'tr_to_en');

            return {
                ...word,
                progress: {
                    en_to_tr: enToTr ? {
                        box: enToTr.leitner_box,
                        timesAsked: enToTr.times_asked,
                        timesCorrect: enToTr.times_correct
                    } : null,
                    tr_to_en: trToEn ? {
                        box: trToEn.leitner_box,
                        timesAsked: trToEn.times_asked,
                        timesCorrect: trToEn.times_correct
                    } : null
                }
            };
        });

        res.json({ success: true, words: wordsWithProgress });
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

        // Create progress entries
        createProgressForWord(result.lastInsertRowid);

        res.json({
            success: true,
            word: wordOperations.getById.get(result.lastInsertRowid)
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

        const fs = require('fs');
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

                    createProgressForWord(result.lastInsertRowid);
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

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get working set with stats
router.get('/working-set', (req, res) => {
    try {
        const workingSet = getWorkingSetWithStats();
        const overallSuccessRate = Math.round(getWorkingSetSuccessRate() * 100);

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

// Get entire set with stats (all words in database)
router.get('/entire-set', (req, res) => {
    try {
        const entireSet = getEntireSetWithStats();
        const workingSetSize = getWorkingSetSize();
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

// Get progress overview
router.get('/progress', (req, res) => {
    try {
        const progressStats = getProgressStats();
        const learnerStats = learnerStatsOperations.get.get();
        const recentActivity = dailyActivityOperations.getRecent.all(30);
        const recentSessions = sessionOperations.getRecent.all(20);
        const achievements = achievementOperations.getAll.all();

        res.json({
            success: true,
            data: {
                progress: progressStats,
                learner: learnerStats,
                recentActivity,
                recentSessions,
                achievements: achievements.map(a => ({
                    ...a,
                    data: a.data ? JSON.parse(a.data) : null
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset all learning progress
router.post('/reset', (req, res) => {
    try {
        const { confirm } = req.body;

        if (confirm !== 'RESET') {
            return res.status(400).json({
                success: false,
                error: 'Please confirm reset by sending { "confirm": "RESET" }'
            });
        }

        // Reset all progress-related tables
        db.exec(`
            DELETE FROM progress;
            DELETE FROM sessions;
            DELETE FROM daily_activity;
            DELETE FROM achievements;
            UPDATE learner_stats SET total_stars = 0, current_streak = 0, longest_streak = 0, last_active_date = NULL WHERE id = 1;
        `);

        // Recreate progress entries for all words
        const words = wordOperations.getAll.all();
        for (const word of words) {
            createProgressForWord(word.id);
        }

        res.json({ success: true, message: 'All progress has been reset' });
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
        const allowedKeys = ['quick_lesson_count', 'weak_words_count', 'mastered_review_chance', 'timezone', 'answer_timeout'];

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
