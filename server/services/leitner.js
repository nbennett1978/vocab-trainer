// Leitner spaced repetition system service

const {
    db,
    progressOperations,
    settingsOperations
} = require('../db/database');

// Box intervals: how often to review words in each box
// Box 1: every session, Box 2: every 2nd, Box 3: every 4th, Box 4: every 8th, Box 5: occasional
const BOX_INTERVALS = {
    1: 1,
    2: 2,
    3: 4,
    4: 8,
    5: 16  // Mastered - very occasional
};

// Working set size (initial number of words to learn)
const INITIAL_WORKING_SET_SIZE = 25;
const SUCCESS_RATE_THRESHOLD = 0.60; // 60% success rate needed to add new words

// Get the new box after answering
function getNewBox(currentBox, isCorrect) {
    if (isCorrect) {
        // Move up (max box 5)
        return Math.min(currentBox + 1, 5);
    } else {
        // Move back to box 1
        return 1;
    }
}

// Get the current working set (words in box 1-5) for a user
function getWorkingSet(userId, direction) {
    const query = db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.user_id = ? AND p.leitner_box > 0 AND p.direction = ?
        ORDER BY p.leitner_box ASC, p.last_asked ASC
    `);
    return query.all(userId, direction);
}

// Get working set size (count of words in box 1-5 for either direction) for a user
function getWorkingSetSize(userId) {
    const query = db.prepare(`
        SELECT COUNT(DISTINCT word_id) as count
        FROM progress
        WHERE user_id = ? AND leitner_box > 0
    `);
    const result = query.get(userId);
    return result?.count || 0;
}

// Calculate overall success rate for the working set for a user
function getWorkingSetSuccessRate(userId) {
    const query = db.prepare(`
        SELECT
            SUM(times_asked) as total_asked,
            SUM(times_correct) as total_correct
        FROM progress
        WHERE user_id = ? AND leitner_box > 0
    `);
    const result = query.get(userId);

    if (!result || result.total_asked === 0) {
        return 1.0; // No data yet, allow adding words
    }

    return result.total_correct / result.total_asked;
}

// Get words with success rate details for admin view
function getWorkingSetWithStats(userId) {
    const query = db.prepare(`
        SELECT
            w.id,
            w.english,
            w.turkish,
            w.category,
            p_en.leitner_box as en_to_tr_box,
            p_en.times_asked as en_to_tr_asked,
            p_en.times_correct as en_to_tr_correct,
            p_tr.leitner_box as tr_to_en_box,
            p_tr.times_asked as tr_to_en_asked,
            p_tr.times_correct as tr_to_en_correct
        FROM words w
        LEFT JOIN progress p_en ON w.id = p_en.word_id AND p_en.direction = 'en_to_tr' AND p_en.user_id = ?
        LEFT JOIN progress p_tr ON w.id = p_tr.word_id AND p_tr.direction = 'tr_to_en' AND p_tr.user_id = ?
        WHERE p_en.leitner_box > 0 OR p_tr.leitner_box > 0
    `);

    const words = query.all(userId, userId);

    return formatWordsWithStats(words);
}

// Get ALL words with success rate details for admin view (entire set)
function getEntireSetWithStats(userId) {
    const query = db.prepare(`
        SELECT
            w.id,
            w.english,
            w.turkish,
            w.category,
            COALESCE(p_en.leitner_box, 0) as en_to_tr_box,
            COALESCE(p_en.times_asked, 0) as en_to_tr_asked,
            COALESCE(p_en.times_correct, 0) as en_to_tr_correct,
            COALESCE(p_tr.leitner_box, 0) as tr_to_en_box,
            COALESCE(p_tr.times_asked, 0) as tr_to_en_asked,
            COALESCE(p_tr.times_correct, 0) as tr_to_en_correct
        FROM words w
        LEFT JOIN progress p_en ON w.id = p_en.word_id AND p_en.direction = 'en_to_tr' AND p_en.user_id = ?
        LEFT JOIN progress p_tr ON w.id = p_tr.word_id AND p_tr.direction = 'tr_to_en' AND p_tr.user_id = ?
    `);

    const words = query.all(userId, userId);

    return formatWordsWithStats(words);
}

// Helper function to format words with stats
function formatWordsWithStats(words) {
    return words.map(w => {
        const totalAsked = (w.en_to_tr_asked || 0) + (w.tr_to_en_asked || 0);
        const totalCorrect = (w.en_to_tr_correct || 0) + (w.tr_to_en_correct || 0);
        const successRate = totalAsked > 0 ? (totalCorrect / totalAsked) : null;

        return {
            id: w.id,
            english: w.english,
            turkish: w.turkish,
            category: w.category,
            en_to_tr: {
                box: w.en_to_tr_box || 0,
                asked: w.en_to_tr_asked || 0,
                correct: w.en_to_tr_correct || 0
            },
            tr_to_en: {
                box: w.tr_to_en_box || 0,
                asked: w.tr_to_en_asked || 0,
                correct: w.tr_to_en_correct || 0
            },
            totalAsked,
            totalCorrect,
            successRate,
            successRatePercent: successRate !== null ? Math.round(successRate * 100) : null
        };
    });
}

// Initialize working set with random words for a user
function initializeWorkingSet(userId, count = INITIAL_WORKING_SET_SIZE) {
    // Get words that are not yet in the working set (box 0) for this user
    const newWords = db.prepare(`
        SELECT DISTINCT p.word_id
        FROM progress p
        WHERE p.user_id = ? AND p.leitner_box = 0
        ORDER BY RANDOM()
        LIMIT ?
    `).all(userId, count);

    if (newWords.length === 0) return 0;

    // Move these words to box 1 (both directions)
    const updateStmt = db.prepare(`
        UPDATE progress
        SET leitner_box = 1, first_learned = datetime('now')
        WHERE user_id = ? AND word_id = ? AND leitner_box = 0
    `);

    const transaction = db.transaction(() => {
        for (const word of newWords) {
            updateStmt.run(userId, word.word_id);
        }
    });

    transaction();
    return newWords.length;
}

// Add more words to working set for a user
function expandWorkingSet(userId, count = 5) {
    return initializeWorkingSet(userId, count);
}

// Check if we should add more words to the working set for a user
function shouldExpandWorkingSet(userId) {
    const workingSetSize = getWorkingSetSize(userId);

    // If working set is empty, initialize it
    if (workingSetSize === 0) {
        return { shouldExpand: true, reason: 'empty', initialSize: INITIAL_WORKING_SET_SIZE };
    }

    // Check success rate
    const successRate = getWorkingSetSuccessRate(userId);

    if (successRate >= SUCCESS_RATE_THRESHOLD) {
        return { shouldExpand: true, reason: 'success_rate', successRate };
    }

    return { shouldExpand: false, reason: 'low_success_rate', successRate };
}

// Select words for a session for a user
function selectWordsForSession(userId, sessionType, categoryFilter, direction) {
    const quickSetting = settingsOperations.get.get('quick_lesson_count');
    const weakSetting = settingsOperations.get.get('weak_words_count');

    const settings = {
        quick: parseInt(quickSetting?.value || '5'),
        weak_words: parseInt(weakSetting?.value || '5'),
        review_mastered: 10,
        category: parseInt(quickSetting?.value || '5')
    };

    const targetCount = settings[sessionType] || 5;
    const masteredReviewChance = parseFloat(settingsOperations.get.get('mastered_review_chance')?.value || '0.1');

    // Check if we need to initialize or expand working set
    const expansionCheck = shouldExpandWorkingSet(userId);
    if (expansionCheck.shouldExpand) {
        if (expansionCheck.reason === 'empty') {
            initializeWorkingSet(userId, INITIAL_WORKING_SET_SIZE);
        } else if (expansionCheck.reason === 'success_rate') {
            expandWorkingSet(userId, 5); // Add 5 more words when doing well
        }
    }

    let selectedWords = [];

    if (sessionType === 'weak_words') {
        // Get the last N weak words (in box 1-2, recently asked)
        const weakWords = progressOperations.getWeakWords.all(userId, direction, targetCount);
        selectedWords = weakWords;

        // If not enough weak words, fill with box 1-3 words
        if (selectedWords.length < targetCount) {
            let dueWords = progressOperations.getWordsDueForReview.all(userId, direction);
            dueWords = dueWords.filter(w => !selectedWords.find(s => s.id === w.id));
            dueWords.sort((a, b) => a.leitner_box - b.leitner_box);
            selectedWords = selectedWords.concat(dueWords.slice(0, targetCount - selectedWords.length));
        }
    } else if (sessionType === 'review_mastered') {
        // Get words from boxes 3-5 (well-learned words for review)
        const reviewWords = progressOperations.getReviewWords.all(userId, direction);
        // Shuffle and take target count
        selectedWords = shuffleArray(reviewWords).slice(0, targetCount);
    } else {
        // Get words from the working set (box 1-5) that are due for review
        let dueWords = progressOperations.getWordsDueForReview.all(userId, direction);

        // Filter by category if needed
        if (categoryFilter && categoryFilter !== 'all') {
            dueWords = dueWords.filter(w => w.category === categoryFilter);
        }

        // Sort by box (lower boxes first - they need more practice)
        dueWords.sort((a, b) => {
            if (a.leitner_box !== b.leitner_box) {
                return a.leitner_box - b.leitner_box;
            }
            // Within same box, prioritize least recently asked
            return new Date(a.last_asked || 0) - new Date(b.last_asked || 0);
        });

        // Take words that are due
        selectedWords = dueWords.slice(0, targetCount);

        // If not enough due words, get ANY words from working set (box 1-5)
        if (selectedWords.length < targetCount) {
            let allWorkingSetWords = getWorkingSet(userId, direction);

            // Filter by category if needed
            if (categoryFilter && categoryFilter !== 'all') {
                allWorkingSetWords = allWorkingSetWords.filter(w => w.category === categoryFilter);
            }

            // Filter out already selected words
            allWorkingSetWords = allWorkingSetWords.filter(w =>
                !selectedWords.find(s => s.id === w.id)
            );

            // Add more words from working set
            const moreWords = allWorkingSetWords.slice(0, targetCount - selectedWords.length);
            selectedWords = selectedWords.concat(moreWords);
        }

        // If STILL not enough, add new words from box 0
        if (selectedWords.length < targetCount) {
            let newWords = progressOperations.getNewWords.all(userId, direction);

            // Filter by category if needed
            if (categoryFilter && categoryFilter !== 'all') {
                newWords = newWords.filter(w => w.category === categoryFilter);
            }

            const wordsToAdd = newWords.slice(0, targetCount - selectedWords.length);
            selectedWords = selectedWords.concat(wordsToAdd);
        }

        // Optionally add 1 mastered word for review
        if (Math.random() < masteredReviewChance && selectedWords.length > 0) {
            let masteredWords = progressOperations.getMasteredWords.all(userId, direction);

            if (categoryFilter && categoryFilter !== 'all') {
                masteredWords = masteredWords.filter(w => w.category === categoryFilter);
            }

            if (masteredWords.length > 0) {
                const randomMastered = masteredWords[Math.floor(Math.random() * masteredWords.length)];
                // Add it if not already in selected
                if (!selectedWords.find(w => w.id === randomMastered.id)) {
                    selectedWords.push(randomMastered);
                }
            }
        }
    }

    // Shuffle the final selection
    return shuffleArray(selectedWords);
}

// Fisher-Yates shuffle
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Get progress statistics for a user
function getProgressStats(userId) {
    const stats = progressOperations.getStats.all(userId);

    // Organize by direction and box
    const result = {
        en_to_tr: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        tr_to_en: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };

    for (const row of stats) {
        if (result[row.direction]) {
            result[row.direction][row.leitner_box] = row.count;
        }
    }

    // Calculate totals and mastered
    const totalWords = (Object.values(result.en_to_tr).reduce((a, b) => a + b, 0) +
                       Object.values(result.tr_to_en).reduce((a, b) => a + b, 0)) / 2;

    // A word is fully mastered when both directions are in box 3, 4, or 5
    const fullyMasteredResult = progressOperations.getTotalMastered.get(userId);
    const fullyMastered = fullyMasteredResult?.count || 0;

    // Add working set info
    const workingSetSize = getWorkingSetSize(userId);
    const successRate = getWorkingSetSuccessRate(userId);

    return {
        byDirection: result,
        totalWords,
        fullyMastered,
        workingSetSize,
        workingSetSuccessRate: Math.round(successRate * 100)
    };
}

// Check if all words are mastered for a user
function areAllWordsMastered(userId) {
    const stats = getProgressStats(userId);
    return stats.totalWords > 0 && stats.fullyMastered === stats.totalWords;
}

// Get count of review words (boxes 3-5) for a user
function getReviewWordCount(userId) {
    const result = progressOperations.countReviewWords.get(userId);
    return result?.count || 0;
}

module.exports = {
    BOX_INTERVALS,
    INITIAL_WORKING_SET_SIZE,
    SUCCESS_RATE_THRESHOLD,
    getNewBox,
    getWorkingSet,
    getWorkingSetSize,
    getWorkingSetSuccessRate,
    getWorkingSetWithStats,
    getEntireSetWithStats,
    initializeWorkingSet,
    expandWorkingSet,
    shouldExpandWorkingSet,
    selectWordsForSession,
    shuffleArray,
    getProgressStats,
    areAllWordsMastered,
    getReviewWordCount
};
