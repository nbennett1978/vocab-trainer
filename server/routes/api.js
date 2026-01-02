// Learner API routes

const express = require('express');
const router = express.Router();

const {
    userOperations,
    learnerStatsOperations,
    achievementOperations,
    dailyActivityOperations,
    wordOperations,
    settingsOperations
} = require('../db/database');
const { getProgressStats, areAllWordsMastered, getReviewWordCount } = require('../services/leitner');
const { startSession, submitAnswer, endSession, getSessionState } = require('../services/session');
const { getTodayDate, daysSince, getTimezone } = require('../utils/timezone');
const { authenticateToken } = require('../middleware/auth');

// ============================================
// PUBLIC AUDIO ENDPOINTS (no auth required)
// ============================================

const path = require('path');
const fs = require('fs');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

// Get audio file for a word (public - no auth needed for HTML5 Audio)
router.get('/audio/:wordId', (req, res) => {
    try {
        const wordId = parseInt(req.params.wordId);
        const audioPath = path.join(AUDIO_DIR, `${wordId}.mp3`);

        if (fs.existsSync(audioPath)) {
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            fs.createReadStream(audioPath).pipe(res);
        } else {
            res.status(404).json({ success: false, error: 'Audio not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if audio exists for a word (public)
router.get('/audio/:wordId/exists', (req, res) => {
    try {
        const wordId = parseInt(req.params.wordId);
        const audioPath = path.join(AUDIO_DIR, `${wordId}.mp3`);
        res.json({ success: true, exists: fs.existsSync(audioPath) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// AUTHENTICATED ROUTES
// ============================================

// All routes below require authentication
router.use(authenticateToken);

// Get dashboard data
router.get('/dashboard', (req, res) => {
    try {
        const userId = req.user.id;

        const stats = learnerStatsOperations.get.get(userId) || {
            total_stars: 0,
            current_streak: 0,
            longest_streak: 0,
            last_active_date: null
        };
        const achievements = achievementOperations.getAll.all(userId);
        const progressStats = getProgressStats(userId);
        const recentActivity = dailyActivityOperations.getRecent.all(userId, 7);
        const wordCount = wordOperations.count.get();
        const quickLessonCount = parseInt(settingsOperations.get.get('quick_lesson_count')?.value || '5');
        const answerTimeout = parseInt(settingsOperations.get.get('answer_timeout')?.value || '30');
        const reviewWordCount = getReviewWordCount(userId);
        const categoryProgress = wordOperations.getCategoryProgress.all(userId, userId);

        // Check for inactivity message
        let inactivityMessage = null;
        if (stats.last_active_date) {
            const daysInactive = daysSince(stats.last_active_date);
            if (daysInactive > 1) {
                inactivityMessage = getInactivityMessage(daysInactive);
            }
        }

        // Check if all words are mastered
        const allMastered = areAllWordsMastered(userId);

        res.json({
            success: true,
            data: {
                stats: {
                    totalStars: stats.total_stars,
                    currentStreak: stats.current_streak,
                    longestStreak: stats.longest_streak,
                    lastActiveDate: stats.last_active_date
                },
                progress: progressStats,
                achievements: achievements.map(a => ({
                    type: a.type,
                    unlockedAt: a.unlocked_at,
                    data: a.data ? JSON.parse(a.data) : null
                })),
                recentActivity,
                totalWords: wordCount.count,
                allMastered,
                inactivityMessage,
                quickLessonCount,
                answerTimeout,
                reviewWordCount,
                categoryProgress,
                timezone: getTimezone(),
                user: {
                    id: req.user.id,
                    username: req.user.username
                }
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get leaderboard
router.get('/leaderboard', (req, res) => {
    try {
        const leaderboard = userOperations.getLeaderboard.all();
        const currentUserId = req.user.id;

        // Find current user's rank
        let currentUserRank = null;
        leaderboard.forEach((user, index) => {
            if (user.id === currentUserId) {
                currentUserRank = index + 1;
            }
        });

        res.json({
            success: true,
            leaderboard: leaderboard.map((user, index) => ({
                rank: index + 1,
                username: user.username,
                totalStars: user.total_stars,
                currentStreak: user.current_streak,
                isCurrentUser: user.id === currentUserId
            })),
            currentUserRank
        });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available categories
router.get('/categories', (req, res) => {
    try {
        const categories = wordOperations.getCategories.all();
        const categoriesWithCounts = wordOperations.getCategoriesWithCounts.all();
        res.json({
            success: true,
            categories: ['all', ...categories.map(c => c.category)],
            categoriesWithCounts: categoriesWithCounts
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start a new session
router.get('/session/start', (req, res) => {
    try {
        const userId = req.user.id;
        const { type = 'quick', category = 'all' } = req.query;

        // Validate session type
        const validTypes = ['quick', 'weak_words', 'review_mastered', 'category'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ success: false, error: 'Invalid session type' });
        }

        const result = startSession(userId, type, category);
        res.json(result);
    } catch (error) {
        console.error('Start session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit an answer
router.post('/session/answer', (req, res) => {
    try {
        const userId = req.user.id;
        const { sessionId, answer, isRetry = false } = req.body;

        if (!sessionId || answer === undefined) {
            return res.status(400).json({ success: false, error: 'Missing sessionId or answer' });
        }

        const result = submitAnswer(userId, sessionId, answer, isRetry);
        res.json(result);
    } catch (error) {
        console.error('Submit answer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// End a session
router.post('/session/end', (req, res) => {
    try {
        const userId = req.user.id;
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'Missing sessionId' });
        }

        const result = endSession(userId, sessionId);
        res.json(result);
    } catch (error) {
        console.error('End session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get session state (for reconnection)
router.get('/session/:sessionId', (req, res) => {
    try {
        const userId = req.user.id;
        const sessionId = parseInt(req.params.sessionId);
        const state = getSessionState(userId, sessionId);

        if (!state) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        res.json({ success: true, session: state });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Inactivity messages
function getInactivityMessage(days) {
    const messages = [
        `Hey! 📚 ${days} days without practice? The words miss you! 💕`,
        `Welcome back! 🌸 It's been ${days} days. Ready to learn? ✨`,
        `${days} days away? 🤔 The vocabulary is getting lonely! 💖`,
        `Hey superstar! 🌟 ${days} days is too long! Let's practice! 🎀`,
        `The words have been waiting ${days} days for you! 📖💕`,
        `${days} days break? Time to wake up those brain cells! 🧠✨`
    ];
    return messages[Math.floor(Math.random() * messages.length)];
}

module.exports = router;
