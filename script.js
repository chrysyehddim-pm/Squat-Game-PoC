// ==========================================
// 0. 初始化 Firebase (請確保填入您的 API Key)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB6wcFs5gSiNDCSweKcEzgRpbIAAb5I3Vo", // 建議檢查 GCP 白名單是否包含 github.io
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
let isReadyToScore = false; // 嚴格重置邏輯開關
let showEffectTimer = 0; 
let timeLeft = 15;          // 🚀 縮短為 15 秒
let gameActive = false; 
let isTeachingMode = false; // 🚀 教學模式
let isCameraStarted = false;
let countdownNumber = 0;    // 🚀 倒數 321 狀態
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
// 4. 核心偵測與判定邏輯
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

        // 磚塊跟隨鼻子 X 座標
        const blockWidth = 100;
        const blockHeight = 100;
        let blockX = (nose.x * canvasElement.width) - (blockWidth / 2);
        const blockY = 50; 

        // 🚀 防破圖保護機制
        if (imgBrick && imgBrick.complete && imgBrick.naturalHeight > 0) {
            canvasCtx.drawImage(imgBrick, blockX, blockY, blockWidth, blockHeight);
        }

        // 模式 1：教學定位模式
        if (isTeachingMode) {
            if (hip && knee && ankle && hip.visibility > 0.5 && ankle.visibility > 0.5) {
                const kneeAngle = calculateAngle(hip, knee, ankle);
                statusBar.innerText = '教學：請試著深蹲到 110 度以下...';
                if (kneeAngle < 110) {
                    isTeachingMode = false;
                    speakMsg("定位成功，準備開始，三... 二... 一...", true);
                    startCountdown();
                }
            } else {
                statusBar.innerText = '⚠️ 請站遠一點，讓腳踝入鏡';
            }
        }

        // 模式 2：視覺倒數
        if (!gameActive && countdownNumber > 0) {
            canvasCtx.fillStyle = 'rgba(0,0,0,0.6)';
            canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
            canvasCtx.fillStyle = '#FF9800';
            canvasCtx.font = 'bold 150px Arial';
            canvasCtx.textAlign = 'center';
            canvasCtx.fillText(countdownNumber, canvasElement.width/2, canvasElement.height/2 + 50);
            canvasCtx.textAlign = 'start';
        }

        // 模式 3：正式遊戲
        if (gameActive) {
            // 🚀 必須偵測到腳踝才能開始計算醫療數據，避免 0 度錯誤
            if (shoulder && hip && knee && ankle && 
                hip.visibility > 0.5 && knee.visibility > 0.5 && ankle.visibility > 0.5) {
                
                const kneeAngle = calculateAngle(hip, knee, ankle);
                const hipAngle = calculateAngle(shoulder, hip, knee);
                const noseCanvasY = nose.y * canvasElement.height;
                const noseCanvasX = nose.x * canvasElement.width;

                const isTouchingBrick = (
                    noseCanvasX > blockX && noseCanvasX < blockX + blockWidth &&
                    noseCanvasY > blockY && noseCanvasY < blockY + blockHeight
                );

                // 記錄合理的醫療角度數據
                if (kneeAngle >= 40 && kneeAngle <= 180) {
                    if (kneeAngle < minKneeAngle) minKneeAngle = kneeAngle;
                    if (kneeAngle > maxKneeAngle) maxKneeAngle = kneeAngle;
                }
                
                // 狀態鎖定：必須先蹲到位
                if (kneeAngle < 110 && hipAngle < 130 && !isReadyToScore) {
                    isReadyToScore = true;
                    statusBar.innerText = '到位！起立頂磚塊！';
                    speakMsg("蹲得好，請起立"); 
                }
                
                // 起身且碰撞判定：解決微蹲得分 Bug
                if (kneeAngle > 155 && isTouchingBrick && isReadyToScore) {
                    isReadyToScore = false; 
                    repsCount++;
                    score += 10;
                    scoreElement.innerText = score;
                    repsElement.innerText = repsCount;
                    statusBar.innerText = '✨ 完美！再蹲一次！';
                    lastEffectX = blockX; 
                    showEffectTimer = 40; 
                    speakMsg("得分", true); 
                }
            } else {
                statusBar.innerText = '⚠️ 偵測不到腳踝，請退後！';
            }
        }

        // 金幣噴發特效
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
// 5. 流程與 Firebase 數據控制
// ==========================================
const camera = new Camera(videoElement, {
    onFrame: async () => { await pose.send({image: videoElement}); },
    width: 640, height: 480, facingMode: 'user'
});

function startCountdown() {
    countdownNumber = 3;
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
    statusBar.innerText = '🔥 遊戲開始！加油！';
    
    const gameTimer = setInterval(() => {
        timeLeft--;
        timeElement.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(gameTimer);
            endGame();
        }
    }, 1000);
}

async function saveToFirebase(gameData) {
    try { await addDoc(collection(db, "squatRecords"), gameData); } 
    catch (e) { console.error("Firebase 寫入失敗: ", e); }
}

function endGame() {
    gameActive = false; 
    statusBar.innerText = '時間到！結算中...';
    speakMsg("時間到，辛苦了", true);

    let finalMin = minKneeAngle === 360 ? 0 : Math.round(minKneeAngle);
    let finalMax = Math.round(maxKneeAngle);
    let avgTime = repsCount > 0 ? (15 / repsCount).toFixed(1) : 0;

    const sessionData = {
        name: userData.name, age: userData.age, reps: repsCount,
        score: score, minAngle: finalMin, maxAngle: finalMax,
        avgTime: avgTime, timestamp: new Date().toISOString()
    };
    saveToFirebase(sessionData);

    // 🚀 更新結算畫面 UI，解決數據顯示不出來的問題
    document.getElementById('result-name').innerText = `${userData.name} (${userData.age}歲)`;
    document.getElementById('result-reps').innerText = repsCount;
    document.getElementById('result-score').innerText = score;
    document.getElementById('result-min-angle').innerText = finalMin + "°";
    document.getElementById('result-max-angle').innerText = finalMax + "°";
    document.getElementById('result-avg-time').innerText = avgTime + " 秒";
    
    setTimeout(() => { switchScreen(screenResult); }, 1500);
}

// ==========================================
// 6. 按鈕事件綁定 (修復下一步失效問題)
// ==========================================

// 下一步：填寫資料並前往說明
btnToIntro.addEventListener('click', () => {
    const nameVal = inputName.value.trim();
    const ageVal = inputAge.value.trim();
    if (!nameVal || !ageVal) {
        alert("請輸入姓名與年齡，才能幫您記錄成績喔！");
        return;
    }
    userData.name = nameVal;
    userData.age = parseInt(ageVal);
    switchScreen(screenIntro);
});

// 播放語音說明
btnPlayInstruction.addEventListener('click', () => {
    speakMsg("遊戲說明：請退後至全身入鏡。先深蹲一次進行定位，接著在十五秒內，移動身體頂破移動中的問號磚塊！", true);
});

// 開始挑戰：初始化相機
btnStartGame.addEventListener('click', () => {
    switchScreen(screenGame); 
    isTeachingMode = true; 
    statusBar.innerText = '正在連線鏡頭，請退後...';
    if (!isCameraStarted) {
        camera.start().then(() => { isCameraStarted = true; });
    }
});

// 再挑戰一次
btnPlayAgain.addEventListener('click', () => {
    switchScreen(screenGame);
    isTeachingMode = true; 
    statusBar.innerText = '請先完成深蹲定位...';
});