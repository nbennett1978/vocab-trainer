// Learner API routes

const express = require('express');
const router = express.Router();

const {
    learnerStatsOperations,
    achievementOperations,
    dailyActivityOperations,
    wordOperations,
    settingsOperations
} = require('../db/database');
const { getProgressStats, areAllWordsMastered, getReviewWordCount } = require('../services/leitner');
const { startSession, submitAnswer, endSession, getSessionState } = require('../services/session');
const { getTodayDate, daysSince } = require('../utils/timezone');

// Get dashboard data
router.get('/dashboard', (req, res) => {
    try {
        const stats = learnerStatsOperations.get.get();
        const achievements = achievementOperations.getAll.all();
        const progressStats = getProgressStats();
        const recentActivity = dailyActivityOperations.getRecent.all(7);
        const wordCount = wordOperations.count.get();
        const quickLessonCount = parseInt(settingsOperations.get.get('quick_lesson_count')?.value || '5');
        const reviewWordCount = getReviewWordCount();
        const categoryProgress = wordOperations.getCategoryProgress.all();

        // Check for inactivity message
        let inactivityMessage = null;
        if (stats.last_active_date) {
            const daysInactive = daysSince(stats.last_active_date);
            if (daysInactive > 1) {
                inactivityMessage = getInactivityMessage(daysInactive);
            }
        }

        // Check if all words are mastered
        const allMastered = areAllWordsMastered();

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
                reviewWordCount,
                categoryProgress
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get available categories
router.get('/categories', (req, res) => {
    try {
        const categories = wordOperations.getCategories.all();
        res.json({
            success: true,
            categories: ['all', ...categories.map(c => c.category)]
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start a new session
router.get('/session/start', (req, res) => {
    try {
        const { type = 'quick', category = 'all' } = req.query;

        // Validate session type
        const validTypes = ['quick', 'weak_words', 'review_mastered', 'category'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ success: false, error: 'Invalid session type' });
        }

        const result = startSession(type, category);
        res.json(result);
    } catch (error) {
        console.error('Start session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit an answer
router.post('/session/answer', (req, res) => {
    try {
        const { sessionId, answer, isRetry = false } = req.body;

        if (!sessionId || answer === undefined) {
            return res.status(400).json({ success: false, error: 'Missing sessionId or answer' });
        }

        const result = submitAnswer(sessionId, answer, isRetry);
        res.json(result);
    } catch (error) {
        console.error('Submit answer error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// End a session
router.post('/session/end', (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ success: false, error: 'Missing sessionId' });
        }

        const result = endSession(sessionId);
        res.json(result);
    } catch (error) {
        console.error('End session error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get session state (for reconnection)
router.get('/session/:sessionId', (req, res) => {
    try {
        const sessionId = parseInt(req.params.sessionId);
        const state = getSessionState(sessionId);

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
