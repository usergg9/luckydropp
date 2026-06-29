// ==========================================================================
// CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================================================
const SUPABASE_URL = "https://ybsrkghhgurjgrfukgox.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_gxjNTA6NmdNdyt46l11XBg_3NlCFRrX";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;

document.addEventListener("DOMContentLoaded", async () => {
    // PERSISTENCIA DE SESIÓN: Detectar si ya hay un usuario logueado
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await handleUserLogin(session.user);
    } else {
        generateRandomPrizeLocal();
    }
    
    // Configuración inicial
    setupScratchEvents();
    setupEventListeners();
    initCanvas();
    loadGlobalCounters();
    listenToRealtimeChanges();
});

// Función para persistir el login y cargar avatar guardado
async function handleUserLogin(user) {
    currentUser = user;
    
    // Obtener perfil y avatar desde Supabase
    const { data: profile } = await supabaseClient
        .from('usuarios')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

    const avatar = profile?.avatar_url || '🦊';
    currentUser.username = profile?.username || user.email.split('@')[0];
    currentUser.avatar_url = avatar;

    // Actualizar UI
    document.getElementById('display-username').textContent = currentUser.username;
    document.getElementById('user-badge-avatar').textContent = avatar;
    document.getElementById('current-avatar-emoji').textContent = avatar;

    document.getElementById('auth-logged-out').classList.add('hidden');
    document.getElementById('auth-logged-in').classList.remove('hidden');

    await checkAndLoadDailyAttempts(user.id);
    loadMyPrizes();
}

// Función para guardar el avatar de forma permanente
async function saveAvatarToDB(emoji) {
    if (!currentUser) return alert("Inicia sesión para guardar tu avatar.");
    
    await supabaseClient
        .from('usuarios')
        .upsert({ id: currentUser.id, avatar_url: emoji });

    currentUser.avatar_url = emoji;
    document.getElementById('current-avatar-emoji').textContent = emoji;
    document.getElementById('user-badge-avatar').textContent = emoji;
}

// Función centralizada para Eventos y Cierre de modales
function setupEventListeners() {
    // 1. CIERRE DE MODALES (Universales)
    ['close-profile', 'close-auth', 'close-prizes', 'close-legendary'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        });
    });

    // 2. ABRIR MODALES
    document.getElementById('profile-btn').addEventListener('click', () => document.getElementById('modal-profile').style.display = 'flex');
    document.getElementById('btn-show-login').addEventListener('click', () => openAuthForm('login'));
    document.getElementById('btn-show-register').addEventListener('click', () => openAuthForm('register'));

    // 3. SELECCIÓN DE AVATAR (con guardado persistente)
    document.querySelectorAll('.avatar-pick').forEach(opt => {
        opt.addEventListener('click', () => saveAvatarToDB(opt.dataset.avatar));
    });

    // ... (Mantén aquí el resto de tus listeners de juego originales) ...
}

// ... (Mantén todas tus funciones originales de juego: scratch, claimPrize, etc.) ...
