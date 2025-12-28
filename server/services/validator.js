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

// Normalize string for comparison (lowercase + Turkish normalization + collapse spaces)
function normalizeForComparison(str) {
    if (!str) return '';
    // Lowercase, trim, normalize Turkish chars, and collapse multiple spaces to single space
    return normalizeTurkish(str.toLowerCase().trim()).replace(/\s+/g, ' ');
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
    ALMOST: 'almost',      // 1 character difference - allow retry
    INCORRECT: 'incorrect'
};

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

    // Calculate distance
    const distance = levenshteinDistance(normalizedUser, normalizedCorrect);

    // Allow retry for 1 character difference
    if (distance === 1) {
        return {
            result: ValidationResult.ALMOST,
            message: 'Almost! Check your spelling 🤔'
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
    extractBlankWord
};
