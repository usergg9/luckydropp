const SUPABASE_URL = "https://ybsrkghhgurjgrfukgox.supabase.co";
const SUPABASE_KEY = "sb_publishable_gxjNTA6NmdNdyt46l11XBg_3NlCFRrX";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
});

let currentUser = null;
let currentPrize = null;
let attemptsLeft = 3;
let timeUnlock = null; 
let gamePhase = "scratch"; 

const canvas = document.getElementById('scratch-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const actionBtn = document.getElementById('action-btn');
const secretPrizeEl = document.getElementById('secret-prize');

document.addEventListener("DOMContentLoaded", async () => {
    setupScratchEvents();
    setupEventListeners();
    initCanvas();
    
    // CORRECCIÓN: Recuperar sesión al cargar la página
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

// CORRECCIÓN: Eventos de cierre y persistencia
function setupEventListeners() {
    // Botón cerrar perfil
    document.getElementById('close-profile-btn').addEventListener('click', () => {
        document.getElementById('modal-profile').style.display = 'none';
    });

    actionBtn.addEventListener('click', () => {
        if (gamePhase === "claim") claimPrize();
        else if (gamePhase === "reset") prepareNextPrize();
    });

    setupModal('profile-btn', 'modal-profile', '.close-btn');
    setupModal('live-prizes-btn', 'modal-prizes-today', '.close-prizes-today-btn', loadPrizesTodayList);
    setupModal('legendary-winners-btn', 'modal-legendary', '.close-legendary-btn', loadLegendaryWinnersList);
    
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
            
            // Guardar avatar de forma persistente
            await supabaseClient.from('usuarios').update({ avatar_url: selectedEmoji }).eq('id', currentUser.id);
            currentUser.avatar_url = selectedEmoji;
            document.getElementById('current-avatar-emoji').textContent = selectedEmoji;
            document.getElementById('user-badge-avatar').textContent = selectedEmoji;
        });
    });
}

// CORRECCIÓN: Carga del perfil del usuario
async function handleUserLogin(user) {
    currentUser = user;
    let { data: perfil } = await supabaseClient.from('usuarios').select('*').eq('id', user.id).single();
    
    currentUser.username = perfil?.username || user.email.split('@')[0];
    currentUser.avatar_url = perfil?.avatar_url || '🦊';

    document.getElementById('auth-logged-out').classList.add('hidden');
    document.getElementById('auth-logged-in').classList.remove('hidden');
    document.getElementById('display-username').textContent = currentUser.username;
    document.getElementById('user-badge-avatar').textContent = currentUser.avatar_url;
    document.getElementById('current-avatar-emoji').textContent = currentUser.avatar_url;

    document.querySelectorAll('.avatar-pick').forEach(p => {
        p.classList.toggle('selected', p.dataset.avatar === currentUser.avatar_url);
    });

    await checkAndLoadDailyAttempts(user.id);
    await loadMyPrizes();
}

// (El resto de tus funciones como scratch, checkScratchPercentage, etc.
// se mantienen igual que en tu archivo original)
function setupModal(triggerId, modalId, closeClass, onOpenCallback = null) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    if (!trigger || !modal) return;
    trigger.addEventListener('click', () => { modal.style.display = 'flex'; if (onOpenCallback) onOpenCallback(); });
    modal.querySelector(closeClass)?.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

// --- Asegúrate de mantener debajo de esto el resto de tus funciones: 
// initCanvas, setupScratchEvents, scratch, checkScratchPercentage, prepareNextPrize, 
// generateRandomPrizeLocal, checkAndLoadDailyAttempts, updateAttemptsUI, 
// claimPrize, handleAuthSubmit, openAuthForm, loadGlobalCounters, loadMyPrizes, 
// loadPrizesTodayList, loadLegendaryWinnersList, listenToRealtimeChanges ---
