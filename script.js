// ==========================================
// 0. 初始化 Firebase (v9 模組化寫法)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 🔥 請將這裡替換成你 Firebase 專案的真實設定值
const firebaseConfig = {
    apiKey: "AIzaSyB6wcFs5gSiNDCSweKcEzgRpbIAAb5I3Vo",
    authDomain: "smart-squat-health.firebaseapp.com",
    projectId: "smart-squat-health",
    storageBucket: "smart-squat-health.firebasestorage.app",
    messagingSenderId: "475970550783",
    appId: "1:475970550783:web:2d7dcacb2e55b562eb05ca",
};

// 啟動 Firebase 與建立資料庫連線
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
// 2. 遊戲變數與醫療數據狀態
// ==========================================
let userData = { name: '', age: 0 }; 
let score = 0;
let repsCount = 0; 
let isSquatting = false; 
let showEffectTimer = 0; 
let timeLeft = 30;         
let gameActive = false;    
let countdownTimer = null; 
let isCameraStarted = false;

// 🔥 醫療數據追蹤變數
let minKneeAngle = 360; // 記錄這回合蹲最深的角度 (越小代表蹲越低)
let maxKneeAngle = 0;   // 記錄這回合站最直的角度
let gameStartTime = 0;  // 用來計算配速

// ==========================================
// 3. 智慧語音引擎 (防重疊機制)
// ==========================================
const synth = window.speechSynthesis;
let lastSpeakTime = 0;

function speakMsg(text, forceInterrupt = false) {
    const now = Date.now();
    
    // 如果沒有強制打斷，且目前正在說話，就直接忽略 (防止語音重疊)
    if (!forceInterrupt && synth.speaking) return;
    
    // 如果沒有強制打斷，設定冷卻時間 (例如 2 秒內不重複唸提示)，避免長輩覺得太吵
    if (!forceInterrupt && (now - lastSpeakTime < 2000)) return;

    // 如果要求強制打斷 (例如得分時)，先取消原本正在唸的廢話
    if (forceInterrupt) {
        synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 1.1; // 稍微調快一點點節奏
    utterance.pitch = 1.0;
    
    synth.speak(utterance);
    lastSpeakTime = now;
}

// ==========================================
// 4. 畫面與模型核心邏輯
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
    if (!gameActive && !isCameraStarted) return; 

    resizeCanvas(); 
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 4});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2, radius: 2});
        
        const blockWidth = 100;
        const blockHeight = 100; 
        const blockX = (canvasElement.width / 2) - (blockWidth / 2);
        const blockY = 20; 
        
        if (imgBrick.complete && imgBrick.naturalHeight !== 0) {
            canvasCtx.drawImage(imgBrick, blockX, blockY, blockWidth, blockHeight);
        }

        if (gameActive) {
            // 同時抓取肩膀、臀部、膝蓋、腳踝
            const shoulder = results.poseLandmarks[11]; // 左肩
            const hip = results.poseLandmarks[23];      // 左臀
            const knee = results.poseLandmarks[25];     // 左膝
            const ankle = results.poseLandmarks[27];    // 左腳踝
            
            // 【防護機制 1】確保四個點都有抓到，且信心度大於 0.5 (避免出鏡瞎猜)
            if (shoulder && hip && knee && ankle && 
                hip.visibility > 0.5 && knee.visibility > 0.5) {
                
                // 計算雙關節角度
                const kneeAngle = calculateAngle(hip, knee, ankle);
                const hipAngle = calculateAngle(shoulder, hip, knee);
                
                // 【防護機制 2】過濾不合理的極端數值 (只記錄 40~180 度之間的合理數據)
                if (kneeAngle > 40 && kneeAngle <= 180) {
                    if (kneeAngle < minKneeAngle) minKneeAngle = kneeAngle;
                    if (kneeAngle > maxKneeAngle) maxKneeAngle = kneeAngle;
                }
                
                // 【醫療級深蹲判定】
                // 條件：膝蓋角度需小於 130 度 (膝蓋彎曲) AND 髖關節角度需小於 140 度 (屁股有往後坐)
                if (kneeAngle < 130 && hipAngle < 140 && !isSquatting) {
                    isSquatting = true;
                    statusBar.innerText = '姿勢標準！起立頂磚塊！';
                    speakMsg("蹲得好，請起立"); 
                }
                
                // 站起判定：膝蓋與髖關節都要伸直才算完成
                if (kneeAngle > 160 && hipAngle > 160 && isSquatting) {
                    isSquatting = false; 
                    repsCount++;
                    score += 10;
                    scoreElement.innerText = score;
                    repsElement.innerText = repsCount;
                    statusBar.innerText = '✨ 漂亮！得分！';
                    
                    showEffectTimer = 40; 
                    speakMsg("得分", true); 
                }
            }
        }

        // --- 金幣彈出與淡出動態特效 ---
        if (showEffectTimer > 0) {
            const progress = 1 - (showEffectTimer / 40); 
            const easeOut = Math.sin(progress * Math.PI / 2);
            const floatY = blockY - (easeOut * 80); 
            const alpha = showEffectTimer < 10 ? (showEffectTimer / 10) : 1;

            canvasCtx.save(); 
            canvasCtx.globalAlpha = alpha;

            if (imgCoin.complete && imgCoin.naturalHeight !== 0) {
                canvasCtx.drawImage(imgCoin, blockX + 25, floatY - 10, 50, 50);
            }
            canvasCtx.fillStyle = '#FF4500'; 
            canvasCtx.font = 'bold 30px Arial';
            canvasCtx.fillText('+10', blockX + 80, floatY + 25);
            
            canvasCtx.restore(); 
            showEffectTimer--; 
        }
    }
});

const camera = new Camera(videoElement, {
    onFrame: async () => { await pose.send({image: videoElement}); },
    width: 640, height: 480, facingMode: 'user'
});

// ==========================================
// 5. 遊戲流程與 Firebase 數據預備
// ==========================================
function startGameTimer() {
    score = 0;
    repsCount = 0;
    timeLeft = 30;
    gameActive = true;
    
    // 重置醫療數據
    minKneeAngle = 360;
    maxKneeAngle = 0;
    gameStartTime = Date.now();
    
    scoreElement.innerText = score;
    repsElement.innerText = repsCount;
    timeElement.innerText = timeLeft;
    statusBar.innerText = '🔥 遊戲開始！快深蹲！';
    
    speakMsg("挑戰開始，請開始深蹲", true);

    countdownTimer = setInterval(() => {
        timeLeft--;
        timeElement.innerText = timeLeft;
        if (timeLeft <= 0) endGame();
    }, 1000);
}

// 模擬將數據推送到 Firebase 的函數
// 正式將數據推送到 Firebase Firestore 的函數
async function saveToFirebase(gameData) {
    console.log("🚀 準備推送到 Firebase 的資料包：", gameData);
    
    try {
        // 在 Firestore 中建立一個名為 "squatRecords" 的集合 (Collection)
        // 系統會自動產生一個隨機的文件 ID (Document ID)
        const docRef = await addDoc(collection(db, "squatRecords"), gameData);
        
        console.log("✅ 數據已成功存入 Firebase！文件 ID: ", docRef.id);
        
    } catch (error) {
        console.error("❌ 寫入 Firebase 發生錯誤: ", error);
        alert("網路連線不穩，成績上傳失敗，請檢查網路狀態。");
    }
}

function endGame() {
    gameActive = false; 
    clearInterval(countdownTimer); 
    statusBar.innerText = '時間到！結算中...';
    speakMsg("時間到，辛苦了，正在為您結算成績", true);

    let title = "";
    if (repsCount >= 13) title = "傳說級深蹲王 👑";
    else if (repsCount >= 6) title = "活力不老松 🌲";
    else if (repsCount >= 1) title = "健康練習生 🏃";
    else title = "還沒暖身好嗎？下次加油！ 😅";

    // 計算配速 (平均做一下花幾秒)
    let avgTime = repsCount > 0 ? (30 / repsCount).toFixed(1) : 0;
    // 防呆：如果都沒做，角度就預設為 0
    let finalMin = minKneeAngle === 360 ? 0 : Math.round(minKneeAngle);
    let finalMax = Math.round(maxKneeAngle);

    // 打包所有數據
    const sessionData = {
        name: userData.name,
        age: userData.age,
        totalScore: score,
        reps: repsCount,
        minAngle: finalMin,
        maxAngle: finalMax,
        avgTimePerRep: avgTime,
        timestamp: new Date().toISOString()
    };

    // 呼叫儲存函數
    saveToFirebase(sessionData);

    // 更新結算畫面 UI
    document.getElementById('result-name').innerText = `${userData.name} (${userData.age}歲)`;
    document.getElementById('result-title').innerText = title;
    document.getElementById('result-reps').innerText = repsCount;
    document.getElementById('result-score').innerText = score;
    document.getElementById('result-min-angle').innerText = finalMin;
    document.getElementById('result-max-angle').innerText = finalMax;
    document.getElementById('result-avg-time').innerText = avgTime;

    setTimeout(() => { switchScreen(screenResult); }, 1500);
}

// ==========================================
// 6. 按鈕事件綁定
// ==========================================
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

// 說明頁的語音按鈕
btnPlayInstruction.addEventListener('click', () => {
    speakMsg("遊戲說明：將手機或平板架好，退後至全身入鏡。聽到提示音後開始深蹲。蹲下再站起，用頭頂破上方磚塊收集金幣！", true);
});

btnStartGame.addEventListener('click', () => {
    switchScreen(screenGame); 
    statusBar.innerText = '正在開啟攝影機與AI模型...';
    
    if (!isCameraStarted) {
        camera.start().then(() => {
            isCameraStarted = true;
            startGameTimer();
        }).catch((err) => {
            statusBar.innerText = '無法啟動鏡頭，請確認權限。';
            console.error(err);
        });
    } else {
        startGameTimer(); 
    }
});

btnPlayAgain.addEventListener('click', () => {
    switchScreen(screenGame);
    startGameTimer();
});