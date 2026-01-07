// Session management service

const {
    db,
    sessionOperations,
    progressOperations,
    dailyActivityOperations,
    learnerStatsOperations,
    achievementOperations,
    settingsOperations,
    transaction
} = require('../db/database');
const { selectWordsForSessionMixed, getNewBox, getProgressStats } = require('./leitner');
const { validateAnswer, ValidationResult, processExampleSentence, compareCharacters } = require('./validator');
const { getTodayDate, getCurrentDateTime, isYesterday } = require('../utils/timezone');

// Active sessions storage (in-memory for simplicity)
// Key format: `${userId}_${sessionId}`
const activeSessions = new Map();

// Start a new training session for a user
function startSession(userId, sessionType, categoryFilter = 'all') {
    // Get target word count from settings
    const quickSetting = settingsOperations.get.get('quick_lesson_count');
    const weakSetting = settingsOperations.get.get('weak_words_count');
    const settings = {
        quick: parseInt(quickSetting?.value || '5'),
        weak_words: parseInt(weakSetting?.value || '5'),
        review_mastered: 10,
        category: parseInt(quickSetting?.value || '5')
    };
    const targetCount = settings[sessionType] || 5;

    // Select words with mixed directions (at least 40% each direction)
    const words = selectWordsForSessionMixed(userId, sessionType, categoryFilter, targetCount);

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

    // Prepare session data - direction is now per-word, not per-session
    const sessionData = {
        id: sessionId,
        userId,
        sessionType,
        categoryFilter,
        words: words.map(w => ({
            progressId: w.id,
            wordId: w.word_id,
            english: w.english,
            turkish: w.turkish,
            category: w.category,
            exampleSentence: w.example_sentence,
            direction: w.direction,  // Direction is now per-word
            leitnerBox: w.leitner_box,
            timesAsked: w.times_asked,
            timesCorrect: w.times_correct,
            isNew: w.leitner_box === 0,
            isRetryAttempt: false,  // First attempt, not a retry
            retryCount: 0           // How many times this word has been retried
        })),
        currentIndex: 0,
        originalWordCount: words.length,  // Track original count for scoring
        results: [],
        starsEarned: 0,
        startedAt: new Date()
    };

    // Store in active sessions (keyed by both userId and sessionId for security)
    activeSessions.set(`${userId}_${sessionId}`, sessionData);

    // Return first question - direction comes from the first word
    return {
        success: true,
        sessionId,
        totalWords: words.length,
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

    // Direction is now per-word
    const direction = word.direction;
    const answer = direction === 'en_to_tr' ? word.turkish : word.english;

    // Count how many first-attempt words have been answered
    const firstAttemptAnswered = sessionData.results.length;

    return {
        index: firstAttemptAnswered,  // Progress based on first attempts only
        total: sessionData.originalWordCount,  // Original word count for scoring
        direction,
        wordId: word.wordId,
        question: direction === 'en_to_tr' ? word.english : word.turkish,
        english: word.english,
        turkish: word.turkish,
        answerHint: generateAnswerHint(answer),
        exampleSentence: processExampleSentence(word.exampleSentence, direction),
        category: word.category,
        isVerb: word.category === 'verb',
        isRetry: word.isRetryAttempt,  // Let UI know this is a retry
        retryNumber: word.retryCount,  // Which retry attempt (1 or 2)
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

    // Direction is now per-word
    const direction = word.direction;
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

    // Check if this is a spaced-retry attempt (not the typo-retry which is isRetry param)
    const isSpacedRetry = word.isRetryAttempt;

    // Only record results and update database for first attempts (not spaced retries)
    if (!isSpacedRetry) {
        // Record the result (first attempts only)
        session.results.push({
            wordId: word.wordId,
            progressId: word.progressId,
            isCorrect,
            userAnswer,
            correctAnswer,
            wasNew: word.isNew
        });

        // Award stars for correct answers (first attempts only)
        if (isCorrect) {
            session.starsEarned += 1;
        }

        // Update progress in database (first attempts only)
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

        // Save session progress to database after each answer (for mobile reliability)
        const wordsAsked = session.results.length;
        const wordsCorrect = session.results.filter(r => r.isCorrect).length;
        sessionOperations.update.run({
            id: sessionId,
            ended_at: null,  // Keep null to indicate still in progress
            words_asked: wordsAsked,
            words_correct: wordsCorrect,
            stars_earned: session.starsEarned
        });
    }

    // Queue word for spaced retry if wrong and under retry limit (max 2 retries)
    if (!isCorrect && word.retryCount < 2) {
        const retryWord = {
            ...word,
            isRetryAttempt: true,
            retryCount: word.retryCount + 1
        };
        // Insert retry 4 positions later (or at end if near end)
        const insertPosition = Math.min(session.currentIndex + 4, session.words.length);
        session.words.splice(insertPosition, 0, retryWord);
    }

    // Move to next word
    session.currentIndex++;

    // Check if session is complete
    const isComplete = session.currentIndex >= session.words.length;

    // Calculate Leitner box for response (use current box for retries since we didn't update)
    const responseBox = isSpacedRetry ? word.leitnerBox : getNewBox(word.leitnerBox === 0 ? 1 : word.leitnerBox, isCorrect);

    // Get character comparison for wrong answers (for visual highlighting)
    const charComparison = !isCorrect ? compareCharacters(userAnswer, correctAnswer) : null;

    const response = {
        success: true,
        result: isCorrect ? 'correct' : 'incorrect',
        correctAnswer,
        correctAnswerLength: correctAnswer.length,  // Show expected character count
        charComparison,  // Character-by-character comparison for highlighting
        newLeitnerBox: responseBox,
        starsEarned: session.starsEarned,
        isComplete,
        isSpacedRetry  // Let frontend know this was a retry
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

    // Direction is now per-word, included in currentWord
    return {
        sessionId: session.id,
        totalWords: session.originalWordCount,  // Use original count, not including retries
        currentIndex: session.results.length,   // First-attempt progress
        starsEarned: session.starsEarned,
        currentWord: prepareWordForClient(session)
    };
}

// Save session progress without ending (for beforeunload/periodic saves)
function saveSessionProgress(userId, sessionId) {
    const session = activeSessions.get(`${userId}_${sessionId}`);
    if (!session) {
        return { success: false, error: 'Session not found' };
    }

    const wordsAsked = session.results.length;
    const wordsCorrect = session.results.filter(r => r.isCorrect).length;
    const starsEarned = session.starsEarned;

    // Update session record with current progress (but don't set ended_at)
    db.prepare(`
        UPDATE sessions
        SET words_asked = ?, words_correct = ?, stars_earned = ?
        WHERE id = ? AND ended_at IS NULL
    `).run(wordsAsked, wordsCorrect, starsEarned, sessionId);

    return { success: true, wordsAsked, wordsCorrect, starsEarned };
}

// Abandon a session (mark it as ended without full completion)
function abandonSession(userId, sessionId) {
    const session = activeSessions.get(`${userId}_${sessionId}`);

    // First save any progress we have
    if (session) {
        saveSessionProgress(userId, sessionId);
        activeSessions.delete(`${userId}_${sessionId}`);
    }

    // Mark session as ended with current timestamp
    const now = getCurrentDateTime();
    sessionOperations.update.run({
        id: sessionId,
        ended_at: now,
        words_asked: session ? session.results.length : 0,
        words_correct: session ? session.results.filter(r => r.isCorrect).length : 0,
        stars_earned: session ? session.starsEarned : 0
    });

    return { success: true };
}

module.exports = {
    startSession,
    submitAnswer,
    endSession,
    getSessionState,
    checkAchievements,
    saveSessionProgress,
    abandonSession
};
