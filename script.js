// ==========================================
// 0. 初始化 Firebase (維持原有模組化寫法)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB6wcFs5gSiNDCSweKcEzgRpbIAAb5I3Vo",
    authDomain: "smart-squat-health.firebaseapp.com",
    projectId: "smart-squat-health",
    storageBucket: "smart-squat-health.firebasestorage.app",
    messagingSenderId: "475970550783",
    appId: "1:475970550783:web:2d7dcacb2e55b562eb05ca",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// 1. 取得 HTML 元素
// ==========================================
const screenLogin = document.getElementById('screen-login');
const screenIntro = document.getElementById('screen-intro');
const screenGame = document.getElementById('screen-game');
const screenResult = document.getElementById('screen-result');

const inputName = document.getElementById('userName');
const inputAge = document.getElementById('userAge');
const btnToIntro = document.getElementById('btn-to-intro');
const btnPlayInstruction = document.getElementById('btn-play-instruction');
const btnStartGame = document.getElementById('btn-start-game');
const btnPlayAgain = document.getElementById('btn-play-again');

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const scoreElement = document.getElementById('score');
const timeElement = document.getElementById('time');
const repsElement = document.getElementById('reps');
const statusBar = document.getElementById('status-bar');

const imgBrick = document.getElementById('img-brick');
const imgCoin = document.getElementById('img-coin');

// ==========================================
// 2. 遊戲變數與數據狀態
// ==========================================
let userData = { name: '', age: 0 }; 
let score = 0;
let repsCount = 0; 
let isSquatting = false; // 是否進入「蹲下」狀態
let isReadyToScore = false; // 是否完成蹲下，正準備「起身」得分
let showEffectTimer = 0; 
let timeLeft = 15; // 🚀 秒數縮短為 15 秒
let gameActive = false; 
let isTeachingMode = false; // 🚀 教學模式狀態
let countdownNumber = 3;    // 🚀 倒數 321
let lastEffectX = 0;
let minKneeAngle = 360; 
let maxKneeAngle = 0;   

// ==========================================
// 3. 智慧語音引擎
// ==========================================
const synth = window.speechSynthesis;
let lastSpeakTime = 0;

function speakMsg(text, forceInterrupt = false) {
    const now = Date.now();
    if (!forceInterrupt && synth.speaking) return;
    if (!forceInterrupt && (now - lastSpeakTime < 2000)) return;
    if (forceInterrupt) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 1.1;
    synth.speak(utterance);
    lastSpeakTime = now;
}

// ==========================================
// 4. 核心邏輯 (包含教學與倒數)
// ==========================================
function switchScreen(screenToShow) {
    screenLogin.classList.add('hidden');
    screenIntro.classList.add('hidden');
    screenGame.classList.add('hidden');
    screenResult.classList.add('hidden');
    screenToShow.classList.remove('hidden');
}

function resizeCanvas() {
    canvasElement.width = canvasElement.clientWidth;
    canvasElement.height = canvasElement.clientHeight;
}
window.addEventListener('resize', resizeCanvas);

function calculateAngle(a, b, c) {
    let radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
}

const pose = new Pose({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
}});
pose.setOptions({
    modelComplexity: 0, smoothLandmarks: true, enableSegmentation: false,
    minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
});

pose.onResults((results) => {
    resizeCanvas(); 
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 4});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2, radius: 2});
        
        const nose = results.poseLandmarks[0];
        const hip = results.poseLandmarks[23];
        const knee = results.poseLandmarks[25];
        const ankle = results.poseLandmarks[27];
        const shoulder = results.poseLandmarks[11];

        // 磚塊位置
        const blockWidth = 100;
        const blockHeight = 100;
        let blockX = (nose.x * canvasElement.width) - (blockWidth / 2);
        const blockY = 50; 

        if (imgBrick && imgBrick.complete && imgBrick.naturalHeight > 0) {
            canvasCtx.drawImage(imgBrick, blockX, blockY, blockWidth, blockHeight);
        }

        // --- 🚀 模式 1：教學模式 (正確動作後進入倒數) ---
        if (isTeachingMode) {
            if (hip && knee && ankle && hip.visibility > 0.5) {
                const kneeAngle = calculateAngle(hip, knee, ankle);
                statusBar.innerText = '請先試著蹲到 110 度以下...';
                
                if (kneeAngle < 110) {
                    isTeachingMode = false;
                    speakMsg("很好，準備開始，3... 2... 1...", true);
                    startCountdown();
                }
            }
        }

        // --- 🚀 模式 2：倒數顯示 ---
        if (!gameActive && !isTeachingMode && countdownNumber > 0 && countdownNumber <= 3) {
            canvasCtx.fillStyle = 'rgba(0,0,0,0.5)';
            canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
            canvasCtx.fillStyle = '#FF9800';
            canvasCtx.font = 'bold 150px Arial';
            canvasCtx.textAlign = 'center';
            canvasCtx.fillText(countdownNumber, canvasElement.width/2, canvasElement.height/2 + 50);
            canvasCtx.textAlign = 'start';
        }

        // --- 🚀 模式 3：正式遊戲 ---
        if (gameActive) {
            if (shoulder && hip && knee && ankle && hip.visibility > 0.5 && knee.visibility > 0.5) {
                const kneeAngle = calculateAngle(hip, knee, ankle);
                const hipAngle = calculateAngle(shoulder, hip, knee);
                const noseCanvasY = nose.y * canvasElement.height;
                const noseCanvasX = nose.x * canvasElement.width;

                const isTouchingBrick = (
                    noseCanvasX > blockX && noseCanvasX < blockX + blockWidth &&
                    noseCanvasY > blockY && noseCanvasY < blockY + blockHeight
                );

                if (kneeAngle > 40 && kneeAngle <= 180) {
                    if (kneeAngle < minKneeAngle) minKneeAngle = kneeAngle;
                    if (kneeAngle > maxKneeAngle) maxKneeAngle = kneeAngle;
                }
                
                // 🚀 嚴格判定邏輯：必須先「深蹲到位」
                if (kneeAngle < 110 && hipAngle < 130 && !isReadyToScore) {
                    isReadyToScore = true; // 鎖定狀態：已經蹲夠深了
                    statusBar.innerText = '到位了！起立頂磚塊！';
                    speakMsg("蹲得好，請起立"); 
                }
                
                // 🚀 必須「站得夠直 (155度)」且「頂到磚塊」且「之前有深蹲到位」
                if (kneeAngle > 155 && isTouchingBrick && isReadyToScore) {
                    isReadyToScore = false; // 🚀 重要：得分後重置，強迫下一次必須重新深蹲
                    repsCount++;
                    score += 10;
                    scoreElement.innerText = score;
                    repsElement.innerText = repsCount;
                    statusBar.innerText = '✨ 得分！請再蹲一次！';
                    lastEffectX = blockX; 
                    showEffectTimer = 40; 
                    speakMsg("得分", true); 
                }
            }
        }

        // 金幣動畫
        if (showEffectTimer > 0) {
            const progress = 1 - (showEffectTimer / 40); 
            const easeOut = Math.sin(progress * Math.PI / 2);
            const floatY = blockY - (easeOut * 80); 
            const alpha = showEffectTimer < 10 ? (showEffectTimer / 10) : 1;
            canvasCtx.save(); 
            canvasCtx.globalAlpha = alpha;
            if (imgCoin && imgCoin.complete && imgCoin.naturalHeight > 0) {
                canvasCtx.drawImage(imgCoin, lastEffectX + 25, floatY - 10, 50, 50);
            }
            canvasCtx.restore(); 
            showEffectTimer--; 
        }
    }
});

// ==========================================
// 5. 流程控制 (教學 -> 倒數 -> 遊戲)
// ==========================================
function startCountdown() {
    countdownNumber = 3;
    statusBar.innerText = '準備倒數...';
    const timer = setInterval(() => {
        countdownNumber--;
        if (countdownNumber <= 0) {
            clearInterval(timer);
            startGameLoop();
        }
    }, 1000);
}

function startGameLoop() {
    score = 0; repsCount = 0; timeLeft = 15; gameActive = true;
    minKneeAngle = 360; maxKneeAngle = 0;
    scoreElement.innerText = score;
    repsElement.innerText = repsCount;
    timeElement.innerText = timeLeft;
    statusBar.innerText = '🔥 遊戲開始！';
    
    const gameTimer = setInterval(() => {
        timeLeft--;
        timeElement.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            endGame();
        }
    }, 1000);
}

// 相機與 Firebase (維持原有功能)
const camera = new Camera(videoElement, {
    onFrame: async () => { await pose.send({image: videoElement}); },
    width: 640, height: 480, facingMode: 'user'
});

async function saveToFirebase(gameData) {
    try { await addDoc(collection(db, "squatRecords"), gameData); } 
    catch (e) { console.error(e); }
}

function endGame() {
    gameActive = false; 
    statusBar.innerText = '時間到！結算中...';
    speakMsg("時間到，正在結算成績", true);

    const sessionData = {
        name: userData.name, age: userData.age, reps: repsCount,
        minAngle: Math.round(minKneeAngle), timestamp: new Date().toISOString()
    };
    saveToFirebase(sessionData);

    document.getElementById('result-name').innerText = `${userData.name} (${userData.age}歲)`;
    document.getElementById('result-reps').innerText = repsCount;
    setTimeout(() => { switchScreen(screenResult); }, 1500);
}

// 按鈕綁定
btnStartGame.addEventListener('click', () => {
    switchScreen(screenGame); 
    isTeachingMode = true; // 🚀 開啟教學模式
    statusBar.innerText = '正在初始化鏡頭...';
    if (!isCameraStarted) {
        camera.start().then(() => { isCameraStarted = true; });
    }
});
// (其他按鈕如 btnToIntro, btnPlayAgain 邏輯不變)
