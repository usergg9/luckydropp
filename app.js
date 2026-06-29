// ==========================================================================
// CONFIGURACIÓN CENTRALIZADA DE SUPABASE
// ==========================================================================
const SUPABASE_URL = "https://ybsrkghhgurjgrfukgox.supabase.co";
const SUPABASE_KEY = "sb_publishable_gxjNTA6NmdNdyt46l11XBg_3NlCFRrX";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage
    }
});

// ==========================================================================
// MOTOR DE ESTADO GLOBAL
// ==========================================================================
let currentUser = null;
let currentPrize = null;
let attemptsLeft = 3;
let timeUnlock = null; 
let isScratchedEnough = false; 
let gamePhase = "scratch"; 
let isDrawing = false; 

const canvas = document.getElementById('scratch-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const actionBtn = document.getElementById('action-btn');
const secretPrizeEl = document.getElementById('secret-prize');
const attemptCircles = document.querySelectorAll('.attempt-circle');

let countdownInterval = null;

const TABLA_PREMIOS_LOCAL = [
    { id: 1, nombre: "🍀 Trébol de 4 Hojas", rareza: "Común", probabilidad: 45.0 },
    { id: 2, nombre: "🐴 Herradura de Bronce", rareza: "Común", probabilidad: 25.0 },
    { id: 3, nombre: "🪙 Moneda de la Fortuna", rareza: "Raro", probabilidad: 15.0 },
    { id: 4, nombre: "🪲 Escarabajo Sagrado", rareza: "Raro", probabilidad: 9.0 },
    { id: 5, nombre: "👁️ Ojo de Horus", rareza: "Épico", probabilidad: 4.5 },
    { id: 6, nombre: "🪶 Atrapasueños Ancestral", rareza: "Épico", probabilidad: 1.4 },
    { id: 7, nombre: "🐱 Maneki-Neko de Oro", rareza: "Legendario", probabilidad: 0.1 }
];

document.addEventListener("DOMContentLoaded", async () => {
    setupScratchEvents();
    setupEventListeners();
    initCanvas();
    
    // CORRECCIÓN: Recuperar sesión persistente de Supabase
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await handleUserLogin(session.user);
    } else {
        updateAttemptsUI();
        generateRandomPrizeLocal(); 
    }

    loadGlobalCounters();
    listenToRealtimeChanges();
});

// ==========================================================================
// CANVAS OPTIMIZADO
// ==========================================================================
function initCanvas() {
    canvas.width = canvas.getBoundingClientRect().width || 360;
    canvas.height = canvas.getBoundingClientRect().height || 220;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ PASA EL DEDO PARA RASCAR ⚡', canvas.width / 2, canvas.height / 2);
    isScratchedEnough = false;
    if(actionBtn && gamePhase === "scratch") {
        actionBtn.disabled = true;
        actionBtn.innerHTML = "<span>Rasca el panel gris</span>";
    }
}

// ... (Las funciones setupScratchEvents, scratch, checkScratchPercentage se mantienen igual)
function setupScratchEvents() {
    const startScratch = () => { if(attemptsLeft > 0 && !timeUnlock) isDrawing = true; };
    const endScratch = () => { isDrawing = false; if(attemptsLeft > 0 && !timeUnlock) checkScratchPercentage(); };
    canvas.addEventListener('mousedown', startScratch);
    canvas.addEventListener('touchstart', startScratch);
    window.addEventListener('mouseup', endScratch); 
    window.addEventListener('touchend', endScratch);
    canvas.addEventListener('mousemove', scratch);
    canvas.addEventListener('touchmove', (e) => { scratch(e); e.preventDefault(); });
}

function scratch(e) {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2); 
    ctx.fill();
}

function checkScratchPercentage() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let transparentPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) transparentPixels++; }
    const percentage = (transparentPixels / (pixels.length / 4)) * 100;
    if (percentage > 10.0 && !isScratchedEnough) {
        isScratchedEnough = true;
        gamePhase = "claim";
        actionBtn.disabled = false;
        actionBtn.innerHTML = "<span>🔮 Canjear Premio en Vivo</span>";
    }
}

// ==========================================================================
// GESTIÓN DE USUARIO Y AVATAR PERSISTENTE
// ==========================================================================
async function handleUserLogin(user) {
    currentUser = user;
    let { data: perfil } = await supabaseClient.from('usuarios').select('*').eq('id', user.id).single();
    
    // Si no hay perfil, creamos uno básico
    currentUser.username = perfil?.username || user.email.split('@')[0];
    currentUser.avatar_url = perfil?.avatar_url || '🦊';

    document.getElementById('auth-logged-out').classList.add('hidden');
    document.getElementById('auth-logged-in').classList.remove('hidden');
    document.getElementById('display-username').textContent = currentUser.username;
    document.getElementById('user-badge-avatar').textContent = currentUser.avatar_url;
    document.getElementById('current-avatar-emoji').textContent = currentUser.avatar_url;

    // Sincronizar selección visual del avatar
    document.querySelectorAll('.avatar-pick').forEach(p => {
        p.classList.toggle('selected', p.dataset.avatar === currentUser.avatar_url);
    });

    await checkAndLoadDailyAttempts(user.id);
    await loadMyPrizes();
}

function setupEventListeners() {
    // CORRECCIÓN: Botón de cerrar perfil añadido
    document.getElementById('close-profile-btn')?.addEventListener('click', () => {
        document.getElementById('modal-profile').style.display = 'none';
    });

    actionBtn.addEventListener('click', () => {
        if (gamePhase === "claim") claimPrize();
        else if (gamePhase === "reset") prepareNextPrize();
    });

    setupModal('profile-btn', 'modal-profile', '.close-btn');
    // ... (resto de listeners igual)
    document.getElementById('btn-show-login').addEventListener('click', () => openAuthForm('login'));
    document.getElementById('btn-show-register').addEventListener('click', () => openAuthForm('register'));
    document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.reload();
    });

    document.querySelectorAll('.avatar-pick').forEach(opt => {
        opt.addEventListener('click', async () => {
            if(!currentUser) return alert("Inicia sesión primero.");
            const selectedEmoji = opt.dataset.avatar;
            document.querySelectorAll('.avatar-pick').forEach(p => p.classList.remove('selected'));
            opt.classList.add('selected');
            
            // CORRECCIÓN: Guardado en BD para que sea persistente siempre
            await supabaseClient.from('usuarios').update({ avatar_url: selectedEmoji }).eq('id', currentUser.id);
            currentUser.avatar_url = selectedEmoji;
            document.getElementById('current-avatar-emoji').textContent = selectedEmoji;
            document.getElementById('user-badge-avatar').textContent = selectedEmoji;
        });
    });
}

// ... (Mantener todas tus funciones de prepareNextPrize, checkAndLoadDailyAttempts, 
//      claimPrize, loadGlobalCounters, etc. iguales)

function setupModal(triggerId, modalId, closeClass, onOpenCallback = null) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    if (!trigger || !modal) return;
    trigger.addEventListener('click', () => { modal.style.display = 'flex'; if (onOpenCallback) onOpenCallback(); });
    modal.querySelector(closeClass)?.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

// Incluye aquí el resto de tus funciones originales (handleAuthSubmit, loadMyPrizes, etc.)
// Estas no necesitan cambios, ya que la lógica central de persistencia está en handleUserLogin.
