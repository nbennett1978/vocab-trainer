// Confetti celebration effect

function createConfetti() {
    const container = document.getElementById('confetti-container');
    const colors = ['#FF69B4', '#FFB6C1', '#9370DB', '#DDA0DD', '#FFD700', '#FF8B94', '#7FD8A6'];
    const shapes = ['square', 'circle'];

    // Create confetti pieces
    for (let i = 0; i < 100; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            const color = colors[Math.floor(Math.random() * colors.length)];
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            const size = Math.random() * 10 + 5;
            const left = Math.random() * 100;
            const animationDuration = Math.random() * 2 + 2;
            const delay = Math.random() * 0.5;

            confetti.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: ${shape === 'circle' ? '50%' : '2px'};
                left: ${left}%;
                top: -20px;
                opacity: 1;
                animation: confettiFall ${animationDuration}s ease-out ${delay}s forwards;
                transform: rotate(${Math.random() * 360}deg);
            `;

            container.appendChild(confetti);

            // Remove after animation
            setTimeout(() => confetti.remove(), (animationDuration + delay) * 1000);
        }, i * 20);
    }
}

// Add confetti animation
const confettiStyle = document.createElement('style');
confettiStyle.textContent = `
    @keyframes confettiFall {
        0% {
            top: -20px;
            opacity: 1;
            transform: translateX(0) rotate(0deg);
        }
        100% {
            top: 100vh;
            opacity: 0;
            transform: translateX(${Math.random() > 0.5 ? '' : '-'}${Math.random() * 200}px) rotate(${Math.random() * 720}deg);
        }
    }
`;
document.head.appendChild(confettiStyle);

// Export for use
window.createConfetti = createConfetti;
