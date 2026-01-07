// Answer validation service

// Turkish character normalization map
const TURKISH_CHAR_MAP = {
    'ç': 'c', 'Ç': 'C',
    'ğ': 'g', 'Ğ': 'G',
    'ı': 'i', 'İ': 'I',
    'ö': 'o', 'Ö': 'O',
    'ş': 's', 'Ş': 'S',
    'ü': 'u', 'Ü': 'U'
};

// Normalize Turkish characters to ASCII equivalents
function normalizeTurkish(str) {
    if (!str) return '';
    return str.split('').map(char => TURKISH_CHAR_MAP[char] || char).join('');
}

// Normalize string for comparison (lowercase + Turkish normalization + collapse spaces + normalize hyphens)
function normalizeForComparison(str) {
    if (!str) return '';
    // Lowercase, trim, normalize Turkish chars, convert hyphens to spaces, collapse multiple spaces
    return normalizeTurkish(str.toLowerCase().trim())
        .replace(/-/g, ' ')      // Convert hyphens to spaces (horse-riding → horse riding)
        .replace(/\s+/g, ' ');   // Collapse multiple spaces to single space
}

// Strip "to " prefix from verbs
function stripToPrefix(str) {
    if (!str) return '';
    const trimmed = str.trim();
    if (trimmed.toLowerCase().startsWith('to ')) {
        return trimmed.substring(3);
    }
    return trimmed;
}

// Calculate Levenshtein distance between two strings
function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;

    // Create matrix
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    // Initialize first column and row
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    // Fill the matrix
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,      // deletion
                dp[i][j - 1] + 1,      // insertion
                dp[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return dp[m][n];
}

// Validation result types
const ValidationResult = {
    CORRECT: 'correct',
    ALMOST: 'almost',      // Close enough - allow retry
    INCORRECT: 'incorrect'
};

// Calculate accuracy percentage based on Levenshtein distance
function calculateAccuracy(userAnswer, correctAnswer) {
    if (!correctAnswer || correctAnswer.length === 0) return 0;
    const distance = levenshteinDistance(userAnswer, correctAnswer);
    const maxLen = Math.max(userAnswer.length, correctAnswer.length);
    if (maxLen === 0) return 100;
    return Math.round(((maxLen - distance) / maxLen) * 100);
}

// Check if answer is "almost correct" (75% correct, minimum 1 character correct)
function isAlmostCorrect(userAnswer, correctAnswer) {
    if (!userAnswer || !correctAnswer) return false;
    if (userAnswer.length === 0) return false;

    const accuracy = calculateAccuracy(userAnswer, correctAnswer);
    const distance = levenshteinDistance(userAnswer, correctAnswer);
    const correctChars = Math.max(correctAnswer.length - distance, 0);

    // Must be at least 75% correct AND have at least 1 correct character
    return accuracy >= 75 && correctChars >= 1 && distance > 0;
}

// Compare two strings character by character for visual highlighting
// Returns array of { char, isCorrect } for each character in userAnswer
function compareCharacters(userAnswer, correctAnswer) {
    const result = [];
    const normalizedUser = normalizeForComparison(userAnswer);
    const normalizedCorrect = normalizeForComparison(correctAnswer);

    // Use original user answer for display, but normalized for comparison
    const displayAnswer = userAnswer || '';
    const userLower = displayAnswer.toLowerCase();
    const correctLower = (correctAnswer || '').toLowerCase();

    for (let i = 0; i < displayAnswer.length; i++) {
        const userChar = userLower[i];
        const correctChar = correctLower[i];

        // Character is correct if it matches at the same position
        // Also normalize Turkish characters for comparison
        const normalizedUserChar = normalizeTurkish(userChar);
        const normalizedCorrectChar = correctChar ? normalizeTurkish(correctChar) : '';

        const isCorrect = normalizedUserChar === normalizedCorrectChar;

        result.push({
            char: displayAnswer[i],
            isCorrect
        });
    }

    return result;
}

// Validate an answer
function validateAnswer(userAnswer, correctAnswer, isVerb = false) {
    // Normalize both answers
    let normalizedUser = normalizeForComparison(userAnswer);
    let normalizedCorrect = normalizeForComparison(correctAnswer);

    // For verbs, also try without "to " prefix
    if (isVerb) {
        const userWithoutTo = normalizeForComparison(stripToPrefix(userAnswer));
        const correctWithoutTo = normalizeForComparison(stripToPrefix(correctAnswer));

        // Check both versions
        if (userWithoutTo === correctWithoutTo || normalizedUser === normalizedCorrect) {
            return {
                result: ValidationResult.CORRECT,
                message: null
            };
        }

        // Use the version without "to" for distance calculation if it's closer
        const distWithTo = levenshteinDistance(normalizedUser, normalizedCorrect);
        const distWithoutTo = levenshteinDistance(userWithoutTo, correctWithoutTo);

        if (distWithoutTo < distWithTo) {
            normalizedUser = userWithoutTo;
            normalizedCorrect = correctWithoutTo;
        }
    }

    // Exact match
    if (normalizedUser === normalizedCorrect) {
        return {
            result: ValidationResult.CORRECT,
            message: null
        };
    }

    // Check if almost correct (75% correct, min 1 character)
    if (isAlmostCorrect(normalizedUser, normalizedCorrect)) {
        const accuracy = calculateAccuracy(normalizedUser, normalizedCorrect);
        return {
            result: ValidationResult.ALMOST,
            message: `Almost! ${accuracy}% correct - check your spelling 🤔`
        };
    }

    // Incorrect
    return {
        result: ValidationResult.INCORRECT,
        message: null
    };
}

// Process example sentence for display
function processExampleSentence(sentence, direction) {
    if (!sentence) return null;

    if (direction === 'en_to_tr') {
        // Show full sentence (remove curly braces)
        return sentence.replace(/\{([^}]+)\}/g, '$1');
    } else {
        // TR to EN: replace {word} with blanks
        return sentence.replace(/\{[^}]+\}/g, '____');
    }
}

// Extract the word that should be blanked from sentence
function extractBlankWord(sentence) {
    if (!sentence) return null;
    const match = sentence.match(/\{([^}]+)\}/);
    return match ? match[1] : null;
}

module.exports = {
    normalizeTurkish,
    normalizeForComparison,
    stripToPrefix,
    levenshteinDistance,
    validateAnswer,
    ValidationResult,
    processExampleSentence,
    extractBlankWord,
    compareCharacters,
    calculateAccuracy
};
