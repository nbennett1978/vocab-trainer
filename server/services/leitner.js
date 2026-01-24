// Leitner spaced repetition system service

const {
    db,
    progressOperations,
    settingsOperations,
    wordOperations,
    initializeProgressForUser
} = require('../db/database');

// Get box intervals from settings (dynamic)
function getBoxIntervals() {
    return {
        1: parseInt(settingsOperations.get.get('box_1_interval')?.value || '1'),
        2: parseInt(settingsOperations.get.get('box_2_interval')?.value || '1'),
        3: parseInt(settingsOperations.get.get('box_3_interval')?.value || '1'),
        4: parseInt(settingsOperations.get.get('box_4_interval')?.value || '8'),
        5: parseInt(settingsOperations.get.get('box_5_interval')?.value || '16')
    };
}

// Legacy constant for backwards compatibility
const BOX_INTERVALS = {
    1: 1,
    2: 2,
    3: 4,
    4: 8,
    5: 16
};

// Working set size (initial number of words to learn)
const INITIAL_WORKING_SET_SIZE = 25;
const SUCCESS_RATE_THRESHOLD = 0.60; // 60% success rate needed to add new words

// Ensure progress records exist for a user (create if missing)
function ensureProgressRecordsExist(userId) {
    const count = db.prepare('SELECT COUNT(*) as count FROM progress WHERE user_id = ?').get(userId);
    if (count.count === 0) {
        // No progress records exist - initialize them
        initializeProgressForUser(userId);
        return true; // Records were created
    }
    return false; // Records already existed
}

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
        const enBox = Number(w.en_to_tr_box) || 0;
        const trBox = Number(w.tr_to_en_box) || 0;
        const enAsked = Number(w.en_to_tr_asked) || 0;
        const trAsked = Number(w.tr_to_en_asked) || 0;
        const enCorrect = Number(w.en_to_tr_correct) || 0;
        const trCorrect = Number(w.tr_to_en_correct) || 0;

        const totalAsked = enAsked + trAsked;
        const totalCorrect = enCorrect + trCorrect;
        const successRate = totalAsked > 0 ? (totalCorrect / totalAsked) : null;

        return {
            id: w.id,
            english: w.english,
            turkish: w.turkish,
            category: w.category,
            en_to_tr: {
                box: enBox,
                asked: enAsked,
                correct: enCorrect
            },
            tr_to_en: {
                box: trBox,
                asked: trAsked,
                correct: trCorrect
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

// Get box 1 minimum size from settings
function getBox1MinSize() {
    return parseInt(settingsOperations.get.get('box_1_min_size')?.value || '5');
}

// Ensure box 1 has minimum number of words for a user/direction
// Moves words from box 0 to box 1 if below minimum
// Now promotes BOTH directions of a word when adding to working set
function ensureBox1MinimumSize(userId, direction) {
    const minSize = getBox1MinSize();
    if (minSize <= 0) return 0; // Feature disabled

    const countResult = progressOperations.countBox1Words.get(userId, direction);
    const currentCount = countResult?.count || 0;

    if (currentCount >= minSize) return 0; // Already at minimum

    const needed = minSize - currentCount;

    // Get new words from box 0 for this direction
    // Only select words where BOTH directions are still in box 0
    const newWords = db.prepare(`
        SELECT p.word_id
        FROM progress p
        WHERE p.user_id = ? AND p.direction = ? AND p.leitner_box = 0
        AND EXISTS (
            SELECT 1 FROM progress p2
            WHERE p2.user_id = p.user_id
            AND p2.word_id = p.word_id
            AND p2.direction != p.direction
            AND p2.leitner_box = 0
        )
        ORDER BY RANDOM()
        LIMIT ?
    `).all(userId, direction, needed);

    if (newWords.length === 0) return 0;

    // Move these words to box 1 for BOTH directions
    const updateStmt = db.prepare(`
        UPDATE progress
        SET leitner_box = 1, first_learned = datetime('now')
        WHERE user_id = ? AND word_id = ? AND leitner_box = 0
    `);

    const transaction = db.transaction(() => {
        for (const word of newWords) {
            // This updates both directions since we don't filter by direction
            updateStmt.run(userId, word.word_id);
        }
    });

    transaction();
    return newWords.length;
}

// Check if a word is due for review based on dynamic intervals
function isWordDueForReview(word, boxIntervals) {
    const box = word.leitner_box;
    if (box <= 0) return false; // Box 0 words are not in working set

    const interval = boxIntervals[box] || 1;
    if (interval === 1) return true; // Every session

    // Check if session_counter is divisible by interval
    return (word.session_counter % interval) === 0;
}

// Get words due for review using dynamic intervals
function getWordsDueForReviewDynamic(userId, direction) {
    const boxIntervals = getBoxIntervals();
    const allWords = getWorkingSet(userId, direction);

    return allWords.filter(word => isWordDueForReview(word, boxIntervals));
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
    // Ensure progress records exist for this user (in case they were never initialized)
    ensureProgressRecordsExist(userId);

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
            let dueWords = getWordsDueForReviewDynamic(userId, direction);
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
        let dueWords = getWordsDueForReviewDynamic(userId, direction);

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

// Select words for a session with mixed directions (at least 40% each direction)
function selectWordsForSessionMixed(userId, sessionType, categoryFilter, targetCount) {
    // Calculate target for each direction (aim for 50/50, but at least 40% each)
    const halfCount = Math.floor(targetCount / 2);
    const extraWord = targetCount % 2;

    // Randomly assign extra word to one direction
    let enTarget = halfCount;
    let trTarget = halfCount;
    if (extraWord > 0) {
        if (Math.random() > 0.5) {
            enTarget += 1;
        } else {
            trTarget += 1;
        }
    }

    // Select words from each direction
    const enWords = selectWordsForSession(userId, sessionType, categoryFilter, 'en_to_tr');
    const trWords = selectWordsForSession(userId, sessionType, categoryFilter, 'tr_to_en');

    // Attach direction to each word
    enWords.forEach(w => w.direction = 'en_to_tr');
    trWords.forEach(w => w.direction = 'tr_to_en');

    // Take target amount from each direction
    let selectedEn = enWords.slice(0, enTarget);
    let selectedTr = trWords.slice(0, trTarget);

    // If one direction has fewer words, fill from the other
    const enShortfall = enTarget - selectedEn.length;
    const trShortfall = trTarget - selectedTr.length;

    if (enShortfall > 0 && trWords.length > trTarget) {
        // Not enough EN words, take more from TR
        const extraTr = trWords.slice(trTarget, trTarget + enShortfall);
        selectedTr = selectedTr.concat(extraTr);
    }

    if (trShortfall > 0 && enWords.length > enTarget) {
        // Not enough TR words, take more from EN
        const extraEn = enWords.slice(enTarget, enTarget + trShortfall);
        selectedEn = selectedEn.concat(extraEn);
    }

    // Combine and shuffle
    const combined = selectedEn.concat(selectedTr);
    return shuffleArray(combined);
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

// Fix words that are only in the working set for one direction
// This finds words where one direction is box > 0 and the other is box 0,
// and promotes the box 0 direction to box 1
function fixSingleDirectionWords() {
    const { userOperations } = require('../db/database');
    const users = userOperations.getAll.all();

    let totalFixed = 0;

    for (const user of users) {
        // Find words where one direction is in working set (box > 0) but other is not (box = 0)
        const singleDirectionWords = db.prepare(`
            SELECT p1.word_id, p1.direction as active_direction, p2.direction as inactive_direction
            FROM progress p1
            JOIN progress p2 ON p1.user_id = p2.user_id AND p1.word_id = p2.word_id AND p1.direction != p2.direction
            WHERE p1.user_id = ?
            AND p1.leitner_box > 0
            AND p2.leitner_box = 0
        `).all(user.id);

        if (singleDirectionWords.length === 0) continue;

        // Promote the inactive direction to box 1
        const updateStmt = db.prepare(`
            UPDATE progress
            SET leitner_box = 1, first_learned = COALESCE(first_learned, datetime('now'))
            WHERE user_id = ? AND word_id = ? AND direction = ? AND leitner_box = 0
        `);

        const transaction = db.transaction(() => {
            for (const word of singleDirectionWords) {
                updateStmt.run(user.id, word.word_id, word.inactive_direction);
            }
        });

        transaction();
        totalFixed += singleDirectionWords.length;

        if (singleDirectionWords.length > 0) {
            console.log(`Fixed ${singleDirectionWords.length} single-direction words for user ${user.username}`);
        }
    }

    return totalFixed;
}

module.exports = {
    BOX_INTERVALS,
    INITIAL_WORKING_SET_SIZE,
    SUCCESS_RATE_THRESHOLD,
    getBoxIntervals,
    getNewBox,
    getWorkingSet,
    getWorkingSetSize,
    getWorkingSetSuccessRate,
    getWorkingSetWithStats,
    getEntireSetWithStats,
    initializeWorkingSet,
    expandWorkingSet,
    ensureBox1MinimumSize,
    shouldExpandWorkingSet,
    selectWordsForSession,
    selectWordsForSessionMixed,
    getWordsDueForReviewDynamic,
    shuffleArray,
    getProgressStats,
    areAllWordsMastered,
    getReviewWordCount,
    ensureProgressRecordsExist,
    fixSingleDirectionWords
};
