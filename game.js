// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove, onDisconnect, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// --- USER MUST CONFIGURE THIS ---
const firebaseConfig = {
    apiKey: "AIzaSyCKDTKMDldMP6i6Mcvhn6J1vB_gQ9Q71JE",
    authDomain: "touch-race-d6022.firebaseapp.com",
    databaseURL: "https://touch-race-d6022-default-rtdb.firebaseio.com",
    projectId: "touch-race-d6022",
    storageBucket: "touch-race-d6022.firebasestorage.app",
    messagingSenderId: "562896691028",
    appId: "1:562896691028:web:7a43ca965003731275b2c1"
};
// --------------------------------

let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
} catch (e) {
    console.warn("Firebase Init Error:", e);
    // Alert logic handled below if db usage fails
}

// Game Constants
const MAX_PLAYERS = 6;
const WIN_SCORE = 50; // Taps needed to win (Short race for kids)

// State
let myState = {
    id: 'player_' + Math.random().toString(36).substr(2, 9),
    name: "익명",
    char: "🐰",
    room: null,
    score: 0,
    isHost: false,
    finished: false
};
let players = {};
let gameStatus = 'waiting'; // waiting, countdown, playing, ended

// DOM Elements
const scenes = {
    lobby: document.getElementById('lobby-scene'),
    waiting: document.getElementById('waiting-scene'),
    game: document.getElementById('game-scene')
};
const lobbyStatus = document.getElementById('lobby-status');
const nicknameInput = document.getElementById('nickname-input');
const charBtns = document.querySelectorAll('.char-btn');
const roomTitle = document.getElementById('room-title');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');
const btnStartGame = document.getElementById('btn-start-game');
const waitingMsg = document.getElementById('waiting-msg');
const trackContainer = document.getElementById('track-container');
const btnRun = document.getElementById('btn-run');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownText = document.getElementById('countdown-text');
const resultModal = document.getElementById('result-modal');
const rankList = document.getElementById('rank-list');
const btnBackLobby = document.getElementById('btn-back-lobby');
const btnLeave = document.getElementById('btn-leave');

// --- Event Listeners: Lobby ---
nicknameInput.value = localStorage.getItem('tr_nickname') || "";

charBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        charBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        myState.char = btn.dataset.char;
    });
});

document.querySelectorAll('.key-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const roomNum = btn.innerText;
        const name = nicknameInput.value.trim();
        if (!name) {
            alert("이름을 입력해주세요!");
            nicknameInput.focus();
            return;
        }
        localStorage.setItem('tr_nickname', name);
        myState.name = name;
        joinRoom(roomNum);
    });
});

// --- Event Listeners: Waiting ---
btnStartGame.addEventListener('click', () => {
    if (myState.isHost) {
        update(ref(db, `rooms/${myState.room}`), {
            status: 'countdown'
        });
    }
});

btnLeave.addEventListener('click', leaveRoom);

// --- Event Listeners: Game ---
btnRun.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // Prevent zoom/scroll
    if (gameStatus !== 'playing' || myState.finished) return;

    myState.score++;

    // Check Win locally
    if (myState.score >= WIN_SCORE) {
        finishRace();
    }

    // Update Score to DB
    update(ref(db, `rooms/${myState.room}/players/${myState.id}`), {
        score: myState.score
    });

    // Provide immediate visual feedback (bounce effect)
    btnRun.style.transform = "scale(0.95)";
    setTimeout(() => btnRun.style.transform = "scale(1)", 50);
});

btnBackLobby.addEventListener('click', () => {
    resultModal.classList.add('hidden');
    leaveRoom();
});


// --- Functions ---
function switchScene(sceneName) {
    Object.values(scenes).forEach(el => el.classList.add('hidden'));
    scenes[sceneName].classList.remove('hidden');
}

function joinRoom(roomNum) {
    console.log(`[DEBUG] Joining room: ${roomNum}`);
    if (!db) {
        alert("데이터베이스 연결 실패: Firebase 설정 오류");
        return;
    }

    const roomRef = ref(db, `rooms/${roomNum}`);

    // Transaction to safely join room
    runTransaction(roomRef, (room) => {
        if (!room) {
            // Create room if doesn't exist
            return {
                status: 'waiting',
                players: {
                    [myState.id]: {
                        name: myState.name,
                        char: myState.char,
                        score: 0,
                        isHost: true // First player is host
                    }
                },
                winners: [] // Init empty array
            };
        }

        if (room.status !== 'waiting') {
            // Cannot join running game
            // (returning undefined aborts transaction)
            return;
        }

        const currentPlayers = room.players || {};
        if (Object.keys(currentPlayers).length >= MAX_PLAYERS) {
            // Room full
            return;
        }

        // Add myself
        if (!room.players) room.players = {};
        room.players[myState.id] = {
            name: myState.name,
            char: myState.char,
            score: 0,
            isHost: false
        };

        return room;
    }).then((result) => {
        console.log("[DEBUG] Transaction result:", result);
        if (result.committed) {
            myState.room = roomNum;
            const roomData = result.snapshot.val();
            const me = roomData.players[myState.id];
            myState.isHost = me.isHost;

            // Setup Disconnect Handler (Remove user if they verify close tab)
            onDisconnect(ref(db, `rooms/${roomNum}/players/${myState.id}`)).remove();

            lobbyStatus.innerText = "";
            sceneInitWaiting();
        } else {
            alert("방이 꽉 찼거나 이미 게임이 시작되었습니다.");
        }
    }).catch(err => {
        console.error("[DEBUG] Join Room Error:", err);
        alert("접속 오류: " + err.message);
    });
}

function leaveRoom() {
    if (myState.room) {
        remove(ref(db, `rooms/${myState.room}/players/${myState.id}`));

        myState.room = null;
        myState.score = 0;
        myState.finished = false;
        myState.isHost = false;

        window.location.reload();
    }
}

function sceneInitWaiting() {
    switchScene('waiting');
    roomTitle.innerText = `방 ${myState.room}`;

    // Listen to Room Changes
    onValue(ref(db, `rooms/${myState.room}`), (snapshot) => {
        const room = snapshot.val();
        if (!room) {
            alert("방이 사라졌습니다.");
            window.location.reload();
            return;
        }

        // Update Players List
        players = room.players || {};
        const pArray = Object.values(players);

        // Check if I was kicked
        if (!players[myState.id]) {
            alert("연결이 끊어졌습니다.");
            window.location.reload();
            return;
        }

        // Host Migration Check
        const amIHost = players[myState.id].isHost;
        // If current host left, first player becomes host logic (simplified: trust Firebase order)
        if (!amIHost && pArray.length > 0 && !pArray.find(p => p.isHost)) {
            // If no host found, claim host?
            // Complex logic omitted for simplicity. Assuming host stays.
        }
        myState.isHost = amIHost;

        // Render UI
        renderPlayerList(pArray);

        if (amIHost) {
            btnStartGame.classList.remove('hidden');
            waitingMsg.classList.add('hidden');
        } else {
            btnStartGame.classList.add('hidden');
            waitingMsg.classList.remove('hidden');
        }

        // Check Game Status
        if (room.status === 'countdown' && gameStatus === 'waiting') {
            startGameSequence();
        }

        // Creating Track Runners handled in Game Sequence mainly, 
        // but we can update positions if playing
        if (gameStatus === 'playing') {
            updateRunnersUnsafe(currentPlayers);
        }

        // Check Winners logic
        if (room.winners) {
            const winners = Object.values(room.winners); // Firebase arrays are objects with numeric keys often
            updateRankList(winners);
            if (winners.length > 0 && resultModal.classList.contains('hidden')) {
                // Show result if I finished or game ended?
                // Let's pop modal if *anyone* wins to show excitement?
                // No, only when *I* flip finish line or user requests status.
            }
        }
    });
}

function renderPlayerList(pArray) {
    playerList.innerHTML = '';
    playerCount.innerText = `${pArray.length} / ${MAX_PLAYERS} 명`;

    pArray.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-card ${p.name === myState.name ? 'me' : ''}`;
        div.innerHTML = `
            <span class="char">${p.char}</span>
            <span class="name">${p.name}</span>
            ${p.isHost ? '<span class="badge">방장</span>' : ''}
        `;
        playerList.appendChild(div);
    });
}

function startGameSequence() {
    gameStatus = 'countdown';
    switchScene('game');

    // Setup Track HTML
    trackContainer.innerHTML = '<div class="finish-line"></div>';
    Object.entries(players).forEach(([pid, p]) => {
        const lane = document.createElement('div');
        lane.className = 'lane';
        lane.style.height = `calc(100% / ${MAX_PLAYERS})`;
        // Adjust lane height dynamically if less players? 
        // Better: fixed height per lane or flex.
        // Let's use flex-grow in CSS, already handled.

        lane.innerHTML = `
            <div id="runner-${pid}" class="runner" style="left: 0%">
                <span class="char" style="font-size: 2rem;">${p.char}</span>
                <span class="label">${p.name}</span>
            </div>
        `;
        trackContainer.appendChild(lane);
    });

    // 3, 2, 1 Countdown
    countdownOverlay.classList.remove('hidden');
    let count = 3;
    countdownText.innerText = count;

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownText.innerText = count;
        } else if (count === 0) {
            countdownText.innerText = "START!";
            gameStatus = 'playing';
        } else {
            clearInterval(interval);
            countdownOverlay.classList.add('hidden');
        }
    }, 1000);
}

function updateRunnersUnsafe(currentPlayers) {
    // Only update *other* players to avoid jitter on my own runner?
    // Actually, Firebase local events fire immediately for me, so it's fine.

    // We already have `players` from snapshot.
    // Need to iterate snapshot data.
    // The snapshot `players` object: { player_id: { score: ..., char: ... } }

    // Wait, `players` variable is updated in onValue.
    // But we need safe access.
    // Let's use the local `players` object updated in onValue.

    Object.entries(players).forEach(([pid, p]) => {
        const runnerEl = document.getElementById(`runner-${pid}`);
        if (runnerEl) {
            const pct = Math.min((p.score / WIN_SCORE) * 100, 100);
            runnerEl.style.left = `calc(${pct}% - 30px)`;
        }
    });
}

function finishRace() {
    myState.finished = true;

    // Record my win
    const winnerRef = ref(db, `rooms/${myState.room}/winners`);
    runTransaction(winnerRef, (winners) => {
        winners = winners || [];
        // Check if I already exist (unlikely due to local guard)
        if (!winners.find(w => w.id === myState.id)) {
            winners.push({
                id: myState.id,
                name: myState.name,
                char: myState.char
            });
        }
        return winners;
    });

    // Show Modal
    resultModal.classList.remove('hidden');
}

function updateRankList(winners) {
    rankList.innerHTML = '';
    // Sort logic handled by array order (insertion order = finish order)
    winners.forEach((w, index) => {
        const li = document.createElement('li');
        let badge = '👏 ';
        if (index === 0) badge = '🥇 ';
        if (index === 1) badge = '🥈 ';
        if (index === 2) badge = '🥉 ';

        li.innerText = `${badge} ${w.name} (${w.char})`;
        if (w.id === myState.id) {
            li.style.color = 'var(--accent-color)';
            li.style.fontWeight = 'bold';
        }
        rankList.appendChild(li);
    });
}
