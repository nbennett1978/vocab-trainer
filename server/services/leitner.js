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

// Get the current working set (words in box 1-5)
function getWorkingSet(direction) {
    const query = db.prepare(`
        SELECT p.*, w.english, w.turkish, w.category, w.example_sentence
        FROM progress p
        JOIN words w ON p.word_id = w.id
        WHERE p.leitner_box > 0 AND p.direction = ?
        ORDER BY p.leitner_box ASC, p.last_asked ASC
    `);
    return query.all(direction);
}

// Get working set size (count of words in box 1-5 for either direction)
function getWorkingSetSize() {
    const query = db.prepare(`
        SELECT COUNT(DISTINCT word_id) as count
        FROM progress
        WHERE leitner_box > 0
    `);
    const result = query.get();
    return result?.count || 0;
}

// Calculate overall success rate for the working set
function getWorkingSetSuccessRate() {
    const query = db.prepare(`
        SELECT
            SUM(times_asked) as total_asked,
            SUM(times_correct) as total_correct
        FROM progress
        WHERE leitner_box > 0
    `);
    const result = query.get();

    if (!result || result.total_asked === 0) {
        return 1.0; // No data yet, allow adding words
    }

    return result.total_correct / result.total_asked;
}

// Get words with success rate details for admin view
function getWorkingSetWithStats() {
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
        LEFT JOIN progress p_en ON w.id = p_en.word_id AND p_en.direction = 'en_to_tr'
        LEFT JOIN progress p_tr ON w.id = p_tr.word_id AND p_tr.direction = 'tr_to_en'
        WHERE p_en.leitner_box > 0 OR p_tr.leitner_box > 0
        ORDER BY
            CASE WHEN p_en.leitner_box > 0 AND p_tr.leitner_box > 0 THEN 0 ELSE 1 END,
            (COALESCE(p_en.leitner_box, 0) + COALESCE(p_tr.leitner_box, 0)) ASC
    `);

    const words = query.all();

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

// Initialize working set with random words
function initializeWorkingSet(count = INITIAL_WORKING_SET_SIZE) {
    // Get words that are not yet in the working set (box 0)
    const newWords = db.prepare(`
        SELECT DISTINCT p.word_id
        FROM progress p
        WHERE p.leitner_box = 0
        ORDER BY RANDOM()
        LIMIT ?
    `).all(count);

    if (newWords.length === 0) return 0;

    // Move these words to box 1 (both directions)
    const updateStmt = db.prepare(`
        UPDATE progress
        SET leitner_box = 1, first_learned = datetime('now')
        WHERE word_id = ? AND leitner_box = 0
    `);

    const transaction = db.transaction(() => {
        for (const word of newWords) {
            updateStmt.run(word.word_id);
        }
    });

    transaction();
    return newWords.length;
}

// Add more words to working set
function expandWorkingSet(count = 5) {
    return initializeWorkingSet(count);
}

// Check if we should add more words to the working set
function shouldExpandWorkingSet() {
    const workingSetSize = getWorkingSetSize();

    // If working set is empty, initialize it
    if (workingSetSize === 0) {
        return { shouldExpand: true, reason: 'empty', initialSize: INITIAL_WORKING_SET_SIZE };
    }

    // Check success rate
    const successRate = getWorkingSetSuccessRate();

    if (successRate >= SUCCESS_RATE_THRESHOLD) {
        return { shouldExpand: true, reason: 'success_rate', successRate };
    }

    return { shouldExpand: false, reason: 'low_success_rate', successRate };
}

// Select words for a session
function selectWordsForSession(sessionType, categoryFilter, direction) {
    const quickSetting = settingsOperations.get.get('quick_lesson_count');
    const weakSetting = settingsOperations.get.get('weak_words_count');

    console.log('Settings from DB:', { quick: quickSetting, weak: weakSetting });

    const settings = {
        quick: parseInt(quickSetting?.value || '5'),
        weak_words: parseInt(weakSetting?.value || '5'),
        review_mastered: 10,
        category: parseInt(quickSetting?.value || '5')
    };

    const targetCount = settings[sessionType] || 5;
    console.log(`Session type: ${sessionType}, Target count: ${targetCount}`);
    const masteredReviewChance = parseFloat(settingsOperations.get.get('mastered_review_chance')?.value || '0.1');

    // Check if we need to initialize or expand working set
    const expansionCheck = shouldExpandWorkingSet();
    if (expansionCheck.shouldExpand) {
        if (expansionCheck.reason === 'empty') {
            initializeWorkingSet(INITIAL_WORKING_SET_SIZE);
        } else if (expansionCheck.reason === 'success_rate') {
            expandWorkingSet(5); // Add 5 more words when doing well
        }
    }

    let selectedWords = [];

    if (sessionType === 'weak_words') {
        // Get the last N weak words (in box 1-2, recently asked)
        const weakWords = progressOperations.getWeakWords.all(direction, targetCount);
        selectedWords = weakWords;

        // If not enough weak words, fill with box 1-3 words
        if (selectedWords.length < targetCount) {
            let dueWords = progressOperations.getWordsDueForReview.all(direction);
            dueWords = dueWords.filter(w => !selectedWords.find(s => s.id === w.id));
            dueWords.sort((a, b) => a.leitner_box - b.leitner_box);
            selectedWords = selectedWords.concat(dueWords.slice(0, targetCount - selectedWords.length));
        }
    } else if (sessionType === 'review_mastered') {
        // Get words from boxes 3-5 (well-learned words for review)
        const reviewWords = progressOperations.getReviewWords.all(direction);
        // Shuffle and take target count
        selectedWords = shuffleArray(reviewWords).slice(0, targetCount);
        console.log(`Review words found: ${reviewWords.length}, selected: ${selectedWords.length}`);
    } else {
        // Get words from the working set (box 1-5) that are due for review
        let dueWords = progressOperations.getWordsDueForReview.all(direction);

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
        console.log(`Due words found: ${dueWords.length}, selected: ${selectedWords.length}`);

        // If not enough due words, get ANY words from working set (box 1-5)
        if (selectedWords.length < targetCount) {
            let allWorkingSetWords = getWorkingSet(direction);

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
            console.log(`Added ${moreWords.length} more words from working set`);
        }

        // If STILL not enough, add new words from box 0
        if (selectedWords.length < targetCount) {
            let newWords = progressOperations.getNewWords.all(direction);

            // Filter by category if needed
            if (categoryFilter && categoryFilter !== 'all') {
                newWords = newWords.filter(w => w.category === categoryFilter);
            }

            const wordsToAdd = newWords.slice(0, targetCount - selectedWords.length);
            selectedWords = selectedWords.concat(wordsToAdd);
            console.log(`Added ${wordsToAdd.length} new words from box 0`);
        }

        // Optionally add 1 mastered word for review
        if (Math.random() < masteredReviewChance && selectedWords.length > 0) {
            let masteredWords = progressOperations.getMasteredWords.all(direction);

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
    console.log(`Selected ${selectedWords.length} words for session (target was ${targetCount})`);
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

// Get progress statistics
function getProgressStats() {
    const stats = progressOperations.getStats.all();

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

    // A word is fully mastered when both directions are in box 5
    const fullyMasteredResult = progressOperations.getTotalMastered.get();
    const fullyMastered = fullyMasteredResult?.count || 0;

    // Add working set info
    const workingSetSize = getWorkingSetSize();
    const successRate = getWorkingSetSuccessRate();

    return {
        byDirection: result,
        totalWords,
        fullyMastered,
        workingSetSize,
        workingSetSuccessRate: Math.round(successRate * 100)
    };
}

// Check if all words are mastered
function areAllWordsMastered() {
    const stats = getProgressStats();
    return stats.totalWords > 0 && stats.fullyMastered === stats.totalWords;
}

// Get count of review words (boxes 3-5)
function getReviewWordCount() {
    const result = progressOperations.countReviewWords.get();
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
    initializeWorkingSet,
    expandWorkingSet,
    shouldExpandWorkingSet,
    selectWordsForSession,
    shuffleArray,
    getProgressStats,
    areAllWordsMastered,
    getReviewWordCount
};
