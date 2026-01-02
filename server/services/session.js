// Session management service

const {
    db,
    sessionOperations,
    progressOperations,
    dailyActivityOperations,
    learnerStatsOperations,
    achievementOperations,
    transaction
} = require('../db/database');
const { selectWordsForSession, getNewBox, getProgressStats } = require('./leitner');
const { validateAnswer, ValidationResult, processExampleSentence } = require('./validator');
const { getTodayDate, getCurrentDateTime, isYesterday } = require('../utils/timezone');

// Active sessions storage (in-memory for simplicity)
// Key format: `${userId}_${sessionId}`
const activeSessions = new Map();

// Start a new training session for a user
function startSession(userId, sessionType, categoryFilter = 'all') {
    // Randomly choose direction for this session (or alternate)
    const direction = Math.random() > 0.5 ? 'en_to_tr' : 'tr_to_en';

    // Select words for the session
    const words = selectWordsForSession(userId, sessionType, categoryFilter, direction);

    if (words.length === 0) {
        return {
            success: false,
            error: 'No words available for this session type',
            allMastered: getProgressStats(userId).fullyMastered > 0
        };
    }

    // Create session record
    const sessionResult = sessionOperations.insert.run({
        user_id: userId,
        started_at: getCurrentDateTime(),
        session_type: sessionType,
        category_filter: categoryFilter
    });

    const sessionId = sessionResult.lastInsertRowid;

    // Prepare session data
    const sessionData = {
        id: sessionId,
        userId,
        direction,
        sessionType,
        categoryFilter,
        words: words.map(w => ({
            progressId: w.id,
            wordId: w.word_id,
            english: w.english,
            turkish: w.turkish,
            category: w.category,
            exampleSentence: w.example_sentence,
            leitnerBox: w.leitner_box,
            timesAsked: w.times_asked,
            timesCorrect: w.times_correct,
            isNew: w.leitner_box === 0
        })),
        currentIndex: 0,
        results: [],
        starsEarned: 0,
        startedAt: new Date()
    };

    // Store in active sessions (keyed by both userId and sessionId for security)
    activeSessions.set(`${userId}_${sessionId}`, sessionData);

    // Return first question
    return {
        success: true,
        sessionId,
        totalWords: words.length,
        direction,
        currentWord: prepareWordForClient(sessionData)
    };
}

// Generate underscore hint from answer (e.g., "hello world" → "_ _ _ _ _  _ _ _ _ _")
function generateAnswerHint(answer) {
    if (!answer) return '';

    // Split by spaces to handle multiple words
    const words = answer.split(' ');

    // Convert each word to underscores with spaces between letters
    const hintWords = words.map(word => {
        return word.split('').map(() => '_').join(' ');
    });

    // Join words with double space for visual separation
    return hintWords.join('   ');
}

// Prepare word data for sending to client
function prepareWordForClient(sessionData) {
    const word = sessionData.words[sessionData.currentIndex];
    if (!word) return null;

    const direction = sessionData.direction;
    const answer = direction === 'en_to_tr' ? word.turkish : word.english;

    return {
        index: sessionData.currentIndex,
        total: sessionData.words.length,
        direction,
        wordId: word.wordId,
        question: direction === 'en_to_tr' ? word.english : word.turkish,
        english: word.english,
        turkish: word.turkish,
        answerHint: generateAnswerHint(answer),
        exampleSentence: processExampleSentence(word.exampleSentence, direction),
        category: word.category,
        isVerb: word.category === 'verb',
        stats: {
            timesAsked: word.timesAsked,
            timesCorrect: word.timesCorrect,
            leitnerBox: word.leitnerBox,
            isNew: word.isNew
        }
    };
}

// Submit an answer
function submitAnswer(userId, sessionId, userAnswer, isRetry = false) {
    const session = activeSessions.get(`${userId}_${sessionId}`);
    if (!session) {
        return { success: false, error: 'Session not found' };
    }

    const word = session.words[session.currentIndex];
    if (!word) {
        return { success: false, error: 'No current word' };
    }

    const direction = session.direction;
    const correctAnswer = direction === 'en_to_tr' ? word.turkish : word.english;
    const isVerb = word.category === 'verb';

    // Validate the answer
    const validation = validateAnswer(userAnswer, correctAnswer, isVerb && direction === 'tr_to_en');

    // Handle "almost" result (typo tolerance) - only allow retry on first attempt
    if (validation.result === ValidationResult.ALMOST && !isRetry) {
        return {
            success: true,
            result: 'almost',
            message: validation.message,
            allowRetry: true
        };
    }

    // On retry, require exact match - don't accept "almost" answers
    const isCorrect = validation.result === ValidationResult.CORRECT;

    // Record the result
    session.results.push({
        wordId: word.wordId,
        progressId: word.progressId,
        isCorrect,
        userAnswer,
        correctAnswer,
        wasNew: word.isNew
    });

    // Award stars for correct answers
    if (isCorrect) {
        session.starsEarned += 1;
    }

    // Update progress in database
    const newBox = getNewBox(word.leitnerBox === 0 ? 1 : word.leitnerBox, isCorrect);
    const now = getCurrentDateTime();

    progressOperations.updateAfterAnswer.run({
        id: word.progressId,
        leitner_box: newBox,
        correct: isCorrect ? 1 : 0,
        last_asked: now,
        first_learned: word.isNew ? now : null
    });

    // Track new word introduction
    if (word.isNew) {
        const today = getTodayDate();
        dailyActivityOperations.upsert.run({
            user_id: userId,
            date: today,
            sessions_completed: 0,
            words_introduced: 1,
            stars_earned: 0
        });
    }

    // Move to next word
    session.currentIndex++;

    // Check if session is complete
    const isComplete = session.currentIndex >= session.words.length;

    const response = {
        success: true,
        result: isCorrect ? 'correct' : 'incorrect',
        correctAnswer,
        newLeitnerBox: newBox,
        starsEarned: session.starsEarned,
        isComplete
    };

    if (!isComplete) {
        response.nextWord = prepareWordForClient(session);
    }

    return response;
}

// End a session
function endSession(userId, sessionId) {
    const session = activeSessions.get(`${userId}_${sessionId}`);
    if (!session) {
        return { success: false, error: 'Session not found' };
    }

    const now = getCurrentDateTime();
    const today = getTodayDate();

    // Calculate stats
    const wordsAsked = session.results.length;
    const wordsCorrect = session.results.filter(r => r.isCorrect).length;
    const starsEarned = session.starsEarned;

    // Update session in database
    sessionOperations.update.run({
        id: sessionId,
        ended_at: now,
        words_asked: wordsAsked,
        words_correct: wordsCorrect,
        stars_earned: starsEarned
    });

    // Update daily activity
    dailyActivityOperations.upsert.run({
        user_id: userId,
        date: today,
        sessions_completed: 1,
        words_introduced: 0,
        stars_earned: starsEarned
    });

    // Update learner stats
    updateLearnerStats(userId, today, starsEarned);

    // Check for new achievements
    const newAchievements = checkAchievements(userId);

    // Clean up active session
    activeSessions.delete(`${userId}_${sessionId}`);

    // Get updated progress stats
    const progressStats = getProgressStats(userId);

    return {
        success: true,
        results: {
            wordsAsked,
            wordsCorrect,
            accuracy: wordsAsked > 0 ? Math.round((wordsCorrect / wordsAsked) * 100) : 0,
            starsEarned,
            newAchievements,
            allMastered: progressStats.fullyMastered === progressStats.totalWords && progressStats.totalWords > 0
        }
    };
}

// Update learner stats (streak, stars)
function updateLearnerStats(userId, today, starsEarned) {
    const stats = learnerStatsOperations.get.get(userId) || {
        total_stars: 0,
        current_streak: 0,
        longest_streak: 0,
        last_active_date: null
    };

    let newStreak = stats.current_streak;
    let longestStreak = stats.longest_streak;

    if (stats.last_active_date) {
        if (stats.last_active_date === today) {
            // Already active today, no streak change
        } else if (isYesterday(stats.last_active_date)) {
            // Consecutive day
            newStreak += 1;
            longestStreak = Math.max(longestStreak, newStreak);
        } else {
            // Streak broken
            newStreak = 1;
        }
    } else {
        // First activity ever
        newStreak = 1;
        longestStreak = 1;
    }

    learnerStatsOperations.upsert.run({
        user_id: userId,
        total_stars: stats.total_stars + starsEarned,
        current_streak: newStreak,
        longest_streak: longestStreak,
        last_active_date: today
    });
}

// Check and award achievements
function checkAchievements(userId) {
    const newAchievements = [];
    const progressStats = getProgressStats(userId);
    const fullyMastered = progressStats.fullyMastered;

    // Achievement milestones: every 5 fully mastered words
    const milestones = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250];

    for (const milestone of milestones) {
        if (fullyMastered >= milestone) {
            const achievementType = `mastered_${milestone}`;
            const existing = achievementOperations.getByType.get(userId, achievementType);

            if (!existing) {
                achievementOperations.insert.run({
                    user_id: userId,
                    type: achievementType,
                    data: JSON.stringify({ count: milestone })
                });
                newAchievements.push({
                    type: achievementType,
                    milestone,
                    message: getAchievementMessage(milestone)
                });
            }
        }
    }

    // Streak achievements
    const stats = learnerStatsOperations.get.get(userId) || { current_streak: 0 };
    const streakMilestones = [3, 7, 14, 30, 60, 100];

    for (const streak of streakMilestones) {
        if (stats.current_streak >= streak) {
            const achievementType = `streak_${streak}`;
            const existing = achievementOperations.getByType.get(userId, achievementType);

            if (!existing) {
                achievementOperations.insert.run({
                    user_id: userId,
                    type: achievementType,
                    data: JSON.stringify({ days: streak })
                });
                newAchievements.push({
                    type: achievementType,
                    streak,
                    message: getStreakMessage(streak)
                });
            }
        }
    }

    return newAchievements;
}

// Get achievement message
function getAchievementMessage(milestone) {
    const messages = {
        5: "First 5 words mastered! 🌟 You're on your way!",
        10: "10 words conquered! 🎉 Keep it up!",
        15: "15 words down! 💪 Amazing progress!",
        20: "20 words mastered! 🏆 You're a star!",
        25: "25 words! 🌸 Quarter century champion!",
        30: "30 words! ✨ Incredible work!",
        40: "40 words mastered! 🎀 Superstar status!",
        50: "50 words! 💖 Half a hundred hero!",
        75: "75 words! 🌟 Three quarters master!",
        100: "100 WORDS! 🎊 LEGENDARY! 🎊",
        150: "150 words! 👑 Royalty!",
        200: "200 words! 🌈 Unstoppable!",
        250: "250 words! 💎 Diamond learner!"
    };
    return messages[milestone] || `${milestone} words mastered! 🎉`;
}

// Get streak message
function getStreakMessage(days) {
    const messages = {
        3: "3 day streak! 🔥 Getting warmed up!",
        7: "1 week streak! 🔥🔥 On fire!",
        14: "2 week streak! 🔥🔥🔥 Blazing!",
        30: "30 day streak! 🏆 Monthly champion!",
        60: "60 day streak! 👑 Dedication royalty!",
        100: "100 DAY STREAK! 💎 LEGENDARY!"
    };
    return messages[days] || `${days} day streak! 🔥`;
}

// Get current session state (for reconnection)
function getSessionState(userId, sessionId) {
    const session = activeSessions.get(`${userId}_${sessionId}`);
    if (!session) return null;

    return {
        sessionId: session.id,
        direction: session.direction,
        totalWords: session.words.length,
        currentIndex: session.currentIndex,
        starsEarned: session.starsEarned,
        currentWord: prepareWordForClient(session)
    };
}

module.exports = {
    startSession,
    submitAnswer,
    endSession,
    getSessionState,
    checkAchievements
};
