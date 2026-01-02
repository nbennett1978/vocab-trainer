# Feature: Audio Playback for English Words

## Overview
Add text-to-speech audio playback to the vocab-trainer app. When the student is shown an English word (direction: `en_to_tr`), the system should automatically play a spoken recording of that word. A button should also allow the student to repeat the audio.

## Requirements
1. **Auto-play**: When an English word is displayed (en_to_tr direction), automatically speak the word
2. **Repeat button**: Add a speaker button (🔊) next to the word to replay the audio
3. **No audio for tr_to_en**: When Turkish is shown and English is the answer, do NOT play audio
4. **Use Puter TTS API**: Free, unlimited, no API key required, neural engine for quality

## Technical Implementation

### 1. Add Puter SDK to index.html

In `/public/index.html`, add the Puter script in the `<head>`:

```html
<script src="https://js.puter.com/v2/"></script>
```

### 2. Modify the Training Screen UI

In `/public/index.html`, add an audio repeat button next to the question word (inside the `.question-card` div):

```html
<div class="question-card">
    <div id="example-sentence" class="example-sentence"></div>
    <div class="word-with-audio">
        <div id="question-word" class="question-word">word</div>
        <button id="audio-btn" class="audio-btn" title="Hear pronunciation" style="display: none;">
            🔊
        </button>
    </div>
    <div id="category-badge" class="category-badge">verb</div>
</div>
```

### 3. Add CSS Styles

In `/public/css/style.css`, add styles for the audio button:

```css
.word-with-audio {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
}

.audio-btn {
    background: linear-gradient(135deg, var(--primary-pink), var(--purple));
    border: none;
    border-radius: 50%;
    width: 48px;
    height: 48px;
    font-size: 24px;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 4px 15px rgba(255, 105, 180, 0.3);
}

.audio-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(255, 105, 180, 0.4);
}

.audio-btn:active {
    transform: scale(0.95);
}

.audio-btn.playing {
    animation: pulse 0.5s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
}
```

### 4. Modify app.js - Add Audio Functions

In `/public/js/app.js`, add the following:

#### 4a. Add global variable to track current audio

```javascript
// At the top with other global variables
let currentAudio = null;
let isAudioPlaying = false;
```

#### 4b. Create audio playback function

```javascript
/**
 * Play English word audio using Puter TTS
 * @param {string} word - The English word to speak
 */
async function playWordAudio(word) {
    const audioBtn = document.getElementById('audio-btn');

    // If already playing, stop
    if (currentAudio && isAudioPlaying) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }

    try {
        // Add playing state to button
        if (audioBtn) {
            audioBtn.classList.add('playing');
        }
        isAudioPlaying = true;

        // Use Puter TTS with neural engine for better quality
        currentAudio = await puter.ai.txt2speech(word, {
            voice: "Joanna",      // Clear female voice
            engine: "neural",     // High quality neural engine
            language: "en-US"
        });

        // Set up event listener for when audio ends
        currentAudio.onended = () => {
            isAudioPlaying = false;
            if (audioBtn) {
                audioBtn.classList.remove('playing');
            }
        };

        // Play the audio
        await currentAudio.play();

    } catch (error) {
        console.error('Error playing audio:', error);
        isAudioPlaying = false;
        if (audioBtn) {
            audioBtn.classList.remove('playing');
        }
    }
}
```

#### 4c. Modify displayWord() function

In the existing `displayWord()` function, add audio logic:

```javascript
function displayWord(wordData) {
    // ... existing code that sets up the word display ...

    // Get audio button
    const audioBtn = document.getElementById('audio-btn');

    // Check if this is en_to_tr direction (English word shown)
    const isEnToTr = wordData.direction === 'en_to_tr';

    if (isEnToTr) {
        // Show audio button and auto-play
        audioBtn.style.display = 'inline-flex';

        // Auto-play the English word
        // Small delay to let the UI settle
        setTimeout(() => {
            playWordAudio(wordData.english);
        }, 300);
    } else {
        // Hide audio button for tr_to_en direction
        audioBtn.style.display = 'none';
    }

    // ... rest of existing code ...
}
```

#### 4d. Add event listener for repeat button

In the initialization section (DOMContentLoaded or init function):

```javascript
// Audio repeat button click handler
document.getElementById('audio-btn').addEventListener('click', () => {
    if (currentWordData && currentWordData.direction === 'en_to_tr') {
        playWordAudio(currentWordData.english);
    }
});
```

### 5. Handle Edge Cases

#### 5a. Stop audio when moving to next word

In the `submitAnswer()` function or when transitioning to the next word, stop any playing audio:

```javascript
// Stop current audio if playing
if (currentAudio && isAudioPlaying) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    isAudioPlaying = false;
}
```

#### 5b. Stop audio when session ends

In the `endSession()` function:

```javascript
// Clean up audio
if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    isAudioPlaying = false;
}
```

### 6. Testing Checklist

- [ ] Puter SDK loads without errors
- [ ] Audio plays automatically when English word is shown (en_to_tr)
- [ ] Audio does NOT play when Turkish word is shown (tr_to_en)
- [ ] 🔊 button is visible only for en_to_tr direction
- [ ] 🔊 button replays the word when clicked
- [ ] Audio stops when moving to next word
- [ ] Audio stops when session ends
- [ ] Button shows "playing" animation while audio plays
- [ ] Works on mobile devices
- [ ] Handles network errors gracefully

## Files to Modify

1. `/public/index.html` - Add Puter SDK script, add audio button to question card
2. `/public/css/style.css` - Add audio button styles
3. `/public/js/app.js` - Add audio playback logic

## Notes

- **No backend changes required** - Puter TTS is called directly from the browser
- **No database changes required** - Audio is generated on-the-fly
- **No API keys needed** - Puter is free and keyless
- **Network required** - Puter TTS needs internet connection to work
- **Voice choice**: "Joanna" is a clear, natural-sounding female voice. Alternatives: "Matthew" (male), "Amy" (British female)

## Puter TTS Reference

```javascript
// Basic usage
puter.ai.txt2speech("Hello")
    .then(audio => audio.play());

// With options
puter.ai.txt2speech("Hello", {
    voice: "Joanna",     // Voice name
    engine: "neural",    // "standard", "neural", or "generative"
    language: "en-US"    // Language code
});
```

Available voices for en-US: Joanna, Matthew, Ivy, Kendra, Kimberly, Salli, Joey, Justin

---

## Implementation Prompt

Execute the following changes to add audio playback for English words:

1. **Add Puter SDK** to `index.html`:
   - Add `<script src="https://js.puter.com/v2/"></script>` in the `<head>` section

2. **Modify question card** in `index.html`:
   - Wrap `#question-word` and new audio button in a `.word-with-audio` container
   - Add `<button id="audio-btn" class="audio-btn" style="display: none;">🔊</button>`

3. **Add CSS styles** to `style.css`:
   - `.word-with-audio` flex container
   - `.audio-btn` styling with gradient, hover effects, and `.playing` animation

4. **Modify `app.js`**:
   - Add `currentAudio` and `isAudioPlaying` global variables
   - Add `playWordAudio(word)` async function using Puter TTS with neural engine
   - Modify `displayWord()` to:
     - Check if `direction === 'en_to_tr'`
     - If yes: show audio button, auto-play with 300ms delay
     - If no: hide audio button
   - Add click handler for audio button to replay
   - Stop audio on word transition and session end

5. **Test** all scenarios in the testing checklist
