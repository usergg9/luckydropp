// ==========================================================================
// CONFIGURACIÓN CENTRALIZADA DE SUPABASE
// ==========================================================================
const SUPABASE_URL = "https://ybsrkghhgurjgrfukgox.supabase.co";
const SUPABASE_KEY = "sb_publishable_gxjNTA6NmdNdyt46l11XBg_3NlCFRrX";

supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================================================
// MOTOR DE ESTADO GLOBAL (BLINDADO)
// ==========================================================================
let currentUser = null;
let currentPrize = null;
let attemptsLeft = 3;
let isScratchedEnough = false; 
let gamePhase = "scratch"; 
let isDrawing = false; 

const canvas = document.getElementById('scratch-canvas');
const ctx = canvas.getContext('2d');
const actionBtn = document.getElementById('action-btn');
const secretPrizeEl = document.getElementById('secret-prize');
const attemptCircles = document.querySelectorAll('.attempt-circle');

// ==========================================================================
// INICIALIZADOR DE PROYECTO
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupScratchEvents();
    setupEventListeners();
    initCanvas();
    
    const { data: { session } } = await supabase.auth.getSession();
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
// CAPA GRIS DE RASCADO (CÁLCULO EXACTO DE PÍXELES)
// ==========================================================================
function initCanvas() {
    canvas.width = canvas.offsetWidth || 320;
    canvas.height = canvas.offsetHeight || 220;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ PASA EL DEDO PARA RASCAR ⚡', canvas.width / 2, canvas.height / 2);

    isScratchedEnough = false;
    if(actionBtn && gamePhase === "scratch") {
        actionBtn.disabled = true;
        actionBtn.innerHTML = "<span>Rasca el panel gris</span>";
    }
}

function setupScratchEvents() {
    const startScratch = () => { if(attemptsLeft > 0 && gamePhase === "scratch") isDrawing = true; };
    const endScratch = () => { 
        isDrawing = false; 
        if(attemptsLeft > 0 && gamePhase === "scratch") checkScratchPercentage();
    };
    
    canvas.addEventListener('mousedown', startScratch);
    canvas.addEventListener('touchstart', startScratch);
    window.addEventListener('mouseup', endScratch); 
    window.addEventListener('touchend', endScratch);

    canvas.addEventListener('mousemove', scratch);
    canvas.addEventListener('touchmove', (e) => {
        scratch(e);
        e.preventDefault(); 
    });
}

function scratch(e) {
    if (!isDrawing || gamePhase !== "scratch") return;

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

    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) transparentPixels++;
    }

    const percentage = (transparentPixels / (pixels.length / 4)) * 100;

    if (percentage > 10.0 && !isScratchedEnough) {
        isScratchedEnough = true;
        gamePhase = "claim";
        actionBtn.disabled = false;
        actionBtn.innerHTML = "<span>🔮 Canjear Premio en Vivo</span>";
    }
}

// ==========================================================================
// OBTENCIÓN DE PREMIOS EN TIEMPO REAL
// ==========================================================================
async function prepareNextPrize() {
    initCanvas();
    gamePhase = "scratch";

    const { data: premios, error } = await supabase.from('premios').select('*');
    if (error || !premios || premios.length === 0) {
        generateRandomPrizeLocal();
        return;
    }

    const random = Math.random() * 100;
    let acumulado = 0;
    
    for (let premio of premios) {
        acumulado += premio.probabilidad;
        if (random <= acumulado) {
            currentPrize = premio;
            break;
        }
    }

    secretPrizeEl.querySelector('.prize-rarity').textContent = currentPrize.rareza;
    secretPrizeEl.querySelector('.prize-rarity').className = `prize-rarity rarity-${currentPrize.rareza.toLowerCase()}`;
    secretPrizeEl.querySelector('.prize-name').textContent = currentPrize.nombre;
}

function generateRandomPrizeLocal() {
    currentPrize = { id: 1, nombre: "🍀 Trébol de 4 Hojas", rareza: "Común" };
    secretPrizeEl.querySelector('.prize-rarity').textContent = currentPrize.rareza;
    secretPrizeEl.querySelector('.prize-name').textContent = currentPrize.nombre;
}

// ==========================================================================
// HISTORIAL DE INTENTOS DIARIOS POR USUARIO
// ==========================================================================
async function checkAndLoadDailyAttempts(userId) {
    const hoy = new Date().toISOString().split('T')[0];

    let { data, error } = await supabase
        .from('intentos_diarios')
        .select('*')
        .eq('user_id', userId)
        .eq('fecha', hoy)
        .single();

    if (error && error.code === 'PGRST116') {
        const { data: nuevaFila } = await supabase
            .from('intentos_diarios')
            .insert([{ user_id: userId, intentos_restantes: 3 }])
            .select()
            .single();
        data = nuevaFila;
    }

    attemptsLeft = data ? data.intentos_restantes : 0;
    updateAttemptsUI();
}

function updateAttemptsUI() {
    attemptCircles.forEach((circle, index) => {
        if (index < attemptsLeft) {
            circle.classList.add('active');
        } else {
            circle.classList.remove('active');
        }
    });

    if (attemptsLeft <= 0) {
        actionBtn.disabled = true;
        actionBtn.innerHTML = "<span>Vuelve Mañana</span>";
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(7,10,19,0.85)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// ==========================================================================
// ACCIÓN DE CANJE
// ==========================================================================
async function claimPrize() {
    if (!currentUser) {
        alert("⚠️ Inicia sesión o Regístrate desde el panel superior para poder guardar este premio en tu inventario.");
        return;
    }
    if (attemptsLeft <= 0) return;

    await supabase.from('historial_premios').insert([
        { user_id: currentUser.id, premio_id: currentPrize.id }
    ]);

    attemptsLeft--;
    const hoy = new Date().toISOString().split('T')[0];
    await supabase
        .from('intentos_diarios')
        .update({ intentos_restantes: attemptsLeft })
        .eq('user_id', currentUser.id)
        .eq('fecha', hoy);

    updateAttemptsUI();
    loadMyPrizes(); 

    if (attemptsLeft > 0) {
        gamePhase = "reset";
        actionBtn.innerHTML = "<span>🔄 Volver a intentar</span>";
    } else {
        actionBtn.innerHTML = "<span>Mañana más</span>";
        actionBtn.disabled = true;
    }
}

// ==========================================================================
// SESIONES Y CAMBIO DE AVATAR EN TIEMPO REAL
// ==========================================================================
async function handleUserLogin(user) {
    currentUser = user;
    
    let { data: perfil } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
    if (!perfil) {
        perfil = { username: user.email.split('@')[0], avatar_url: '👤' };
    }

    currentUser.username = perfil.username;
    currentUser.avatar_url = perfil.avatar_url;

    document.getElementById('auth-logged-out').classList.add('hidden');
    document.getElementById('auth-logged-in').classList.remove('hidden');
    document.getElementById('display-username').textContent = perfil.username;
    document.getElementById('user-badge-avatar').textContent = perfil.avatar_url;
    
    document.getElementById('current-avatar-emoji').textContent = perfil.avatar_url;

    document.querySelectorAll('.avatar-pick').forEach(p => {
        if(p.dataset.avatar === perfil.avatar_url) p.classList.add('selected');
    });

    await checkAndLoadDailyAttempts(user.id);
    loadMyPrizes();
    prepareNextPrize();
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('modal-auth-form').dataset.mode;
    const email = document.getElementById('input-email').value;
    const password = document.getElementById('input-password').value;
    const username = document.getElementById('input-username').value;

    if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return alert(error.message);

        if (data.user) {
            await supabase.from('usuarios').insert([
                { id: data.user.id, username: username, avatar_url: '🦊' }
            ]);
            alert("¡Registro místico completado!");
            await supabase.auth.signInWithPassword({ email, password });
            window.location.reload(); 
        }
    } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return alert(error.message);
        window.location.reload(); 
    }
}

// ==========================================================================
// EVENTOS DE NAVEGACIÓN Y CORRECCIÓN DE MODALES CON COMPORTAMIENTO FIJO
// ==========================================================================
function setupEventListeners() {
    actionBtn.addEventListener('click', () => {
        if (gamePhase === "claim") {
            claimPrize();
        } else if (gamePhase === "reset") {
            prepareNextPrize();
        }
    });

    // Cambiado para usar las clases correctas sin romper la consola si no encuentra selectores
    setupModal('profile-btn', 'modal-profile', '.close-btn');
    setupModal('live-prizes-btn', 'modal-prizes-today', '.close-prizes-today-btn', loadPrizesTodayList);
    setupModal('legendary-winners-btn', 'modal-legendary', '.close-legendary-btn', loadLegendaryWinnersList);
    
    document.getElementById('btn-show-login').addEventListener('click', () => openAuthForm('login'));
    document.getElementById('btn-show-register').addEventListener('click', () => openAuthForm('register'));
    document.querySelector('.close-auth-form-btn').addEventListener('click', () => document.getElementById('modal-auth-form').style.display = 'none');

    document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);

    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.reload();
    });

    document.querySelectorAll('.avatar-pick').forEach(opt => {
        opt.addEventListener('click', async () => {
            if(!currentUser) return alert("Inicia sesión primero para guardar tu avatar místico.");
            
            document.querySelectorAll('.avatar-pick').forEach(p => p.classList.remove('selected'));
            opt.classList.add('selected');
            
            const selectedEmoji = opt.dataset.avatar;
            
            await supabase.from('usuarios').update({ avatar_url: selectedEmoji }).eq('id', currentUser.id);
            
            document.getElementById('current-avatar-emoji').textContent = selectedEmoji;
            document.getElementById('user-badge-avatar').textContent = selectedEmoji;
            currentUser.avatar_url = selectedEmoji;
        });
    });
}

function setupModal(triggerId, modalId, closeClass, onOpenCallback = null) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);

    if (!trigger || !modal) return; // Blindaje absoluto contra errores Null

    const closeBtn = modal.querySelector(closeClass);

    trigger.addEventListener('click', () => {
        modal.style.display = 'flex';
        if (onOpenCallback) onOpenCallback();
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => modal.style.display = 'none');
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });
}

function openAuthForm(mode) {
    const modal = document.getElementById('modal-auth-form');
    const title = document.getElementById('auth-form-title');
    const usernameField = document.getElementById('username-field');
    
    modal.style.display = 'flex';
    modal.dataset.mode = mode;

    if (mode === 'register') {
        title.textContent = "Registrar Cuenta Mística";
        usernameField.classList.remove('hidden');
        document.getElementById('input-username').required = true;
    } else {
        title.textContent = "Acceso Invocador";
        usernameField.classList.add('hidden');
        document.getElementById('input-username').required = false;
    }
}

// ==========================================================================
// CONTADORES GLOBALES DE BASE DE DATOS
// ==========================================================================
async function loadGlobalCounters() {
    const hoy = new Date().toISOString().split('T')[0];

    const { count: countToday } = await supabase
        .from('historial_premios')
        .select('*', { count: 'exact', head: true })
        .gte('ganado_at', `${hoy}T00:00:00Z`);

    document.getElementById('count-prizes-today').textContent = countToday || 0;

    const { count: countLegendary } = await supabase
        .from('historial_premios')
        .select('*', { count: 'exact', head: true })
        .eq('premio_id', 7);

    document.getElementById('count-legendary-winners').textContent = countLegendary || 0;
}

async function loadMyPrizes() {
    const container = document.getElementById('my-prizes-list');
    if (!currentUser) return;

    const { data, error } = await supabase
        .from('historial_premios')
        .select('ganado_at, premios(nombre, rareza)')
        .eq('user_id', currentUser.id)
        .order('ganado_at', { ascending: false });

    if(error || !data || data.length === 0) {
        container.innerHTML = '<p class="empty-msg">Tu inventario está vacío de amuletos.</p>';
        return;
    }

    container.innerHTML = data.map(item => `
        <div class="prize-item">
            <span class="rarity-${item.premios?.rareza?.toLowerCase()}">🔮 ${item.premios?.nombre || 'Amuleto Desconocido'}</span>
            <small>${new Date(item.ganado_at).toLocaleDateString()}</small>
        </div>
    `).join('');
}

async function loadPrizesTodayList() {
    const list = document.getElementById('prizes-today-list');
    const hoy = new Date().toISOString().split('T')[0];

    const { data } = await supabase
        .from('historial_premios')
        .select('ganado_at, usuarios(username), premios(nombre)')
        .gte('ganado_at', `${hoy}T00:00:00Z`)
        .order('ganado_at', { ascending: false });

    if(!data || data.length === 0) {
        list.innerHTML = '<li>Nadie ha invocado la suerte hoy todavía.</li>';
        return;
    }

    list.innerHTML = data.map(item => `
        <li><strong>${item.usuarios?.username || 'Invocador Anónimo'}</strong> ha conseguido un <em>${item.premios?.nombre || 'Amuleto'}</em>.</li>
    `).join('');
}

async function loadLegendaryWinnersList() {
    const list = document.getElementById('legendary-winners-list');

    const { data } = await supabase
        .from('historial_premios')
        .select('ganado_at, usuarios(username)')
        .eq('premio_id', 7)
        .order('ganado_at', { ascending: false });

    if(!data || data.length === 0) {
        list.innerHTML = '<li>El Maneki-Neko de Oro no ha sido despertado todavía.</li>';
        return;
    }

    list.innerHTML = data.map(item => `
        <li>👑 <strong>${item.usuarios?.username || 'Místico'}</strong> domó al Gato de Oro el ${new Date(item.ganado_at).toLocaleDateString()}.</li>
    `).join('');
}

function listenToRealtimeChanges() {
    supabase
        .channel('schema-db-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'historial_premios' }, () => {
            loadGlobalCounters();
        })
        .subscribe();
}

prepareNextPrize();
