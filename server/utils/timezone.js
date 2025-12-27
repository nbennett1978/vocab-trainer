// Timezone utilities for GMT+3 (Turkey)

const TIMEZONE = 'Europe/Istanbul';

// Get current date in GMT+3 as YYYY-MM-DD string
function getTodayDate() {
    const now = new Date();
    return now.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

// Get current datetime in GMT+3 as ISO string
function getCurrentDateTime() {
    return new Date().toISOString();
}

// Check if a date string is today (in GMT+3)
function isToday(dateString) {
    return dateString === getTodayDate();
}

// Check if a date string is yesterday (in GMT+3)
function isYesterday(dateString) {
    const today = new Date(getTodayDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return dateString === yesterday.toISOString().split('T')[0];
}

// Get date X days ago
function getDaysAgo(days) {
    const today = new Date(getTodayDate());
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - days);
    return pastDate.toISOString().split('T')[0];
}

// Calculate days since a date
function daysSince(dateString) {
    if (!dateString) return null;
    const today = new Date(getTodayDate());
    const pastDate = new Date(dateString);
    const diffTime = today - pastDate;
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

module.exports = {
    TIMEZONE,
    getTodayDate,
    getCurrentDateTime,
    isToday,
    isYesterday,
    getDaysAgo,
    daysSince
};
