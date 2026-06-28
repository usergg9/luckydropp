// ==========================================================================
// CONFIGURACIÓN CENTRALIZADA DE SUPABASE
// ==========================================================================
const SUPABASE_URL = "https://ybsrkghhgurjgrfukgox.supabase.co";
const SUPABASE_KEY = "sb_publishable_gxjNTA6NmdNdyt46l11XBg_3NlCFRrX";

// Declaración protegida contra restricciones estricta de tracking de navegadores
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage // Obliga a usar el entorno de ventana nativo
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
// SOLUCIÓN AL ERROR DE VELOCIDAD: Añadimos willReadFrequently en el contexto 2D
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
    
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            await handleUserLogin(session.user);
        } else {
            updateAttemptsUI();
            generateRandomPrizeLocal(); 
        }
    } catch (e) {
        // En caso de bloqueo total de persistencia, la app sigue funcionando de manera local fluida
        updateAttemptsUI();
        generateRandomPrizeLocal();
    }

    loadGlobalCounters();
    listenToRealtimeChanges();
});

// ==========================================================================
// CANVAS OPTIMIZADO (RE-RASCABLE)
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

function setupScratchEvents() {
    const startScratch = () => { if(attemptsLeft > 0 && !timeUnlock) isDrawing = true; };
    const endScratch = () => { 
        isDrawing = false; 
        if(attemptsLeft > 0 && !timeUnlock) checkScratchPercentage();
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
// SELECCIÓN MATEMÁTICA DE PREMIOS SEGÚN PROBABILIDADES
// ==========================================================================
async function prepareNextPrize() {
    initCanvas();
    gamePhase = "scratch";

    let premios = TABLA_PREMIOS_LOCAL;
    try {
        let { data, error } = await supabaseClient.from('premios').select('*');
        if (!error && data && data.length > 0) premios = data;
    } catch(e) {}

    const random = Math.random() * 100;
    let acumulado = 0;
    currentPrize = premios[0]; 

    for (let premio of premios) {
        acumulado += premio.probabilidad;
        if (random <= acumulado) {
            currentPrize = premio;
            break;
        }
    }

    secretPrizeEl.querySelector('.prize-rarity').textContent = currentPrize.rareza.toUpperCase();
    secretPrizeEl.querySelector('.prize-rarity').className = `prize-rarity rarity-${currentPrize.rareza.toLowerCase()}`;
    secretPrizeEl.querySelector('.prize-name').textContent = currentPrize.nombre;
}

function generateRandomPrizeLocal() {
    const random = Math.random() * 100;
    let acumulado = 0;
    currentPrize = TABLA_PREMIOS_LOCAL[0];

    for (let premio of TABLA_PREMIOS_LOCAL) {
        acumulado += premio.probabilidad;
        if (random <= acumulado) {
            currentPrize = premio;
            break;
        }
    }
    secretPrizeEl.querySelector('.prize-rarity').textContent = currentPrize.rareza.toUpperCase();
    secretPrizeEl.querySelector('.prize-rarity').className = `prize-rarity rarity-${currentPrize.rareza.toLowerCase()}`;
    secretPrizeEl.querySelector('.prize-name').textContent = currentPrize.nombre;
}

// ==========================================================================
// GESTIÓN DE VIDAS DIARIAS (24 HORAS EXACTAS)
// ==========================================================================
async function checkAndLoadDailyAttempts(userId) {
    try {
        let { data, error } = await supabaseClient
            .from('intentos_diarios')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code === 'PGRST116') {
            const { data: nuevaFila } = await supabaseClient
                .from('intentos_diarios')
                .insert([{ user_id: userId, intentos_restantes: 3, bloqueado_hasta: null }])
                .select()
                .single();
            data = nuevaFila;
        }

        if (data) {
            if (data.bloqueado_hasta && new Date() > new Date(data.bloqueado_hasta)) {
                await supabaseClient
                    .from('intentos_diarios')
                    .update({ intentos_restantes: 3, bloqueado_hasta: null })
                    .eq('user_id', userId);
                attemptsLeft = 3;
                timeUnlock = null;
            } else {
                attemptsLeft = data.intentos_restantes;
                timeUnlock = data.bloqueado_hasta ? new Date(data.bloqueado_hasta) : null;
            }
        }
    } catch (e) {}

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

    if (timeUnlock) {
        clearInterval(countdownInterval);
        actionBtn.disabled = true;
        
        countdownInterval = setInterval(() => {
            const ahora = new Date();
            const diferencia = timeUnlock - ahora;

            if (diferencia <= 0) {
                clearInterval(countdownInterval);
                actionBtn.innerHTML = "<span>🔄 Vidas Listas. ¡Recarga!</span>";
                actionBtn.disabled = false;
                window.location.reload();
            } else {
                const horas = Math.floor(diferencia / (1000 * 60 * 60));
                const minutos = Math.floor((diferencia % (1000 * 60 * 60)) / (1000 * 60));
                const segundos = Math.floor((diferencia % (1000 * 60)) / 1000);
                actionBtn.innerHTML = `<span>⏳ Nuevas Vidas en: ${horas}h ${minutos}m ${segundos}s</span>`;
            }
        }, 1000);

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(7,10,19,0.92)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// ==========================================================================
// CANJE DE PREMIOS
// ==========================================================================
async function claimPrize() {
    if (!currentUser) {
        alert("⚠️ Por favor, inicia sesión para guardar este premio.");
        return;
    }
    if (attemptsLeft <= 0 || timeUnlock) return;

    try {
        await supabaseClient.from('historial_premios').insert([
            { user_id: currentUser.id, premio_id: currentPrize.id }
        ]);

        attemptsLeft--;
        let fechaBloqueo = null;

        if (attemptsLeft === 0) {
            const tiempoEspera = new Date();
            tiempoEspera.setHours(tiempoEspera.getHours() + 24); 
            fechaBloqueo = tiempoEspera.toISOString();
            timeUnlock = tiempoEspera;
        }

        await supabaseClient
            .from('intentos_diarios')
            .update({ intentos_restantes: attemptsLeft, bloqueado_hasta: fechaBloqueo })
            .eq('user_id', currentUser.id);
    } catch(e) {}

    updateAttemptsUI();
    loadMyPrizes(); 

    if (attemptsLeft > 0) {
        gamePhase = "reset";
        actionBtn.innerHTML = "<span>🔄 Volver a intentar</span>";
    }
}

// ==========================================================================
// LOGIN CON CONTROL ANTI-SPAM
// ==========================================================================
async function handleAuthSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('modal-auth-form').dataset.mode;
    const email = document.getElementById('input-email').value;
    const password = document.getElementById('input-password').value;
    const username = document.getElementById('input-username').value;

    if (mode === 'register') {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        
        if (error) {
            if (error.status === 429) {
                return alert("🛑 Seguridad: Has creado demasiadas cuentas seguidas. Espera unos minutos o sube los 'Rate Limits' en el panel de Supabase.");
            }
            return alert(error.message);
        }

        if (data.user) {
            await supabaseClient.from('usuarios').insert([
                { id: data.user.id, username: username, avatar_url: '🦊' }
            ]);
            alert("¡Registro místico completado!");
            await supabaseClient.auth.signInWithPassword({ email, password });
            window.location.reload(); 
        }
    } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) return alert(error.message);
        window.location.reload(); 
    }
}

async function handleUserLogin(user) {
    currentUser = user;
    
    let perfil = { username: user.email.split('@')[0], avatar_url: '👤' };
    try {
        let { data } = await supabaseClient.from('usuarios').select('*').eq('id', user.id).single();
        if (data) perfil = data;
    } catch(e) {}

    currentUser.username = perfil.username;
    currentUser.avatar_url = perfil.avatar_url;

    document.getElementById('auth-logged-out').classList.add('hidden');
    document.getElementById('auth-logged-in').classList.remove('hidden');
    document.getElementById('display-username').textContent = perfil.username;
    document.getElementById('user-badge-avatar').textContent = perfil.avatar_url;
    document.getElementById('current-avatar-emoji').textContent = perfil.avatar_url;

    document.querySelectorAll('.avatar-pick').forEach(p => {
        p.classList.remove('selected');
        if(p.dataset.avatar === perfil.avatar_url) p.classList.add('selected');
    });

    await checkAndLoadDailyAttempts(user.id);
    loadMyPrizes();
    await prepareNextPrize();
}

// ==========================================================================
// EVENTOS Y MODALES SEGUROS
// ==========================================================================
function setupEventListeners() {
    actionBtn.addEventListener('click', () => {
        if (gamePhase === "claim") {
            claimPrize();
        } else if (gamePhase === "reset") {
            prepareNextPrize();
        }
    });

    setupModal('profile-btn', 'modal-profile', '.close-btn');
    setupModal('live-prizes-btn', 'modal-prizes-today', '.close-prizes-today-btn', loadPrizesTodayList);
    setupModal('legendary-winners-btn', 'modal-legendary', '.close-legendary-btn', loadLegendaryWinnersList);
    
    document.getElementById('btn-show-login').addEventListener('click', () => openAuthForm('login'));
    document.getElementById('btn-show-register').addEventListener('click', () => openAuthForm('register'));
    document.querySelector('.close-auth-form-btn').addEventListener('click', () => document.getElementById('modal-auth-form').style.display = 'none');

    document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);

    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.reload();
    });

    document.querySelectorAll('.avatar-pick').forEach(opt => {
        opt.addEventListener('click', async () => {
            if(!currentUser) return alert("Inicia sesión primero para guardar tu avatar místico.");
            
            document.querySelectorAll('.avatar-pick').forEach(p => p.classList.remove('selected'));
            opt.classList.add('selected');
            
            const selectedEmoji = opt.dataset.avatar;
            try {
                await supabaseClient.from('usuarios').update({ avatar_url: selectedEmoji }).eq('id', currentUser.id);
            } catch(e) {}
            
            document.getElementById('current-avatar-emoji').textContent = selectedEmoji;
            document.getElementById('user-badge-avatar').textContent = selectedEmoji;
            currentUser.avatar_url = selectedEmoji;
        });
    });
}

function setupModal(triggerId, modalId, closeClass, onOpenCallback = null) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);

    if (!trigger || !modal) return; 

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
// CONTADORES GLOBALES
// ==========================================================================
async function loadGlobalCounters() {
    const hoy = new Date().toISOString().split('T')[0];
    try {
        const { count: countToday } = await supabaseClient
            .from('historial_premios')
            .select('*', { count: 'exact', head: true })
            .gte('ganado_at', `${hoy}T00:00:00Z`);

        document.getElementById('count-prizes-today').textContent = countToday || 0;

        const { count: countLegendary } = await supabaseClient
            .from('historial_premios')
            .select('*', { count: 'exact', head: true })
            .eq('premio_id', 7);

        document.getElementById('count-legendary-winners').textContent = countLegendary || 0;
    } catch(e) {}
}

async function loadMyPrizes() {
    const container = document.getElementById('my-prizes-list');
    if (!currentUser) return;

    try {
        const { data, error } = await supabaseClient
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
    } catch(e) {}
}

async function loadPrizesTodayList() {
    const list = document.getElementById('prizes-today-list');
    const hoy = new Date().toISOString().split('T')[0];

    try {
        const { data } = await supabaseClient
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
    } catch(e) {}
}

async function loadLegendaryWinnersList() {
    const list = document.getElementById('legendary-winners-list');

    try {
        const { data } = await supabaseClient
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
    } catch(e) {}
}

function listenToRealtimeChanges() {
    try {
        supabaseClient
            .channel('schema-db-changes')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'historial_premios' }, () => {
                loadGlobalCounters();
            })
            .subscribe();
    } catch(e) {}
}
