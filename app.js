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
    
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (!error && session) {
            await handleUserLogin(session.user);
        } else {
            updateAttemptsUI();
            generateRandomPrizeLocal(); 
        }
    } catch (e) {
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
    const optimizacionCtx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = optimizacionCtx.getImageData(0, 0, canvas.width, canvas.height);
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
// SELECCIÓN DE PREMIOS SEGÚN PROBABILIDADES
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
// GESTIÓN DE VIDAS DIARIAS (CORREGIDOS ERRORES 406 Y 400 DE LA API)
// ==========================================================================
async function checkAndLoadDailyAttempts(userId) {
    try {
        let { data, error } = await supabaseClient
            .from('intentos_diarios')
            .select()
            .eq('user_id', userId);

        let registro = data && data.length > 0 ? data[0] : null;

        if (!registro) {
            const { data: nuevaFila, error: insertError } = await supabaseClient
                .from('intentos_diarios')
                .insert({ user_id: userId, intentos_restantes: 3, bloqueado_hasta: null })
                .select();
            
            if (!insertError && nuevaFila) {
                registro = nuevaFila[0];
            }
        }

        if (registro) {
            if (registro.bloqueado_hasta && new Date() > new Date(registro.bloqueado_hasta)) {
                await supabaseClient
                    .from('intentos_diarios')
                    .update({ intentos_restantes: 3, bloqueado_hasta: null })
                    .eq('user_id', userId);
                attemptsLeft = 3;
                timeUnlock = null;
            } else {
                attemptsLeft = registro.intentos_restantes;
                timeUnlock = registro.bloqueado_hasta ? new Date(registro.bloqueado_hasta) : null;
            }
        }
    } catch (e) {
        console.error("Error cargando intentos:", e);
    }

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

    if (timeUnlock || attemptsLeft === 0) {
        clearInterval(countdownInterval);
        actionBtn.disabled = true;
        
        const tickCountdown = () => {
            const ahora = new Date();
            const diferencia = timeUnlock - ahora;

            if (diferencia <= 0) {
                clearInterval(countdownInterval);
                actionBtn.innerHTML = "<span>🔄 ¡Vidas Listas! Recarga la página</span>";
                actionBtn.disabled = false;
            } else {
                const horas = Math.floor(diferencia / (1000 * 60 * 60));
                const minutos = Math.floor((diferencia % (1000 * 60 * 60)) / (1000 * 60));
                const segundos = Math.floor((diferencia % (1000 * 60)) / 1000);
                actionBtn.innerHTML = `<span>⏳ Nuevas Vidas en: ${horas}h ${minutos}m ${segundos}s</span>`;
            }
        };

        if (timeUnlock) {
            countdownInterval = setInterval(tickCountdown, 1000);
            tickCountdown();
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(7,10,19,0.92)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('🚫 AGOTADO: VUELVE MAÑANA', canvas.width / 2, canvas.height / 2);
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
// CONTROL DE ACCESOS Y PERSISTENCIA COMPLETA DEL AVATAR
// ==========================================================================
async function handleAuthSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('modal-auth-form').dataset.mode;
    const email = document.getElementById('input-email').value;
    const password = document.getElementById('input-password').value;
    const username = document.getElementById('input-username').value;

    if (mode === 'register') {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) return alert(error.message);

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
    
    let perfil = { username: user.email.split('@')[0], avatar_url: '🦊' }; 
    
    try {
        let { data, error } = await supabaseClient
            .from('usuarios')
            .select()
            .eq('id', user.id);
            
        if (!error && data && data.length > 0) {
            perfil = data[0]; 
        }
    } catch(e) {
        console.error("Error cargando perfil:", e);
    }

    currentUser.username = perfil.username;
    currentUser.avatar_url = perfil.avatar_url || '🦊'; 

    document.getElementById('auth-logged-out').classList.add('hidden');
    document.getElementById('auth-logged-in').classList.remove('hidden');
    document.getElementById('display-username').textContent = currentUser.username;
    document.getElementById('user-badge-avatar').textContent = currentUser.avatar_url;
    document.getElementById('current-avatar-emoji').textContent = currentUser.avatar_url;

    document.querySelectorAll('.avatar-pick').forEach(p => {
        p.classList.remove('selected');
        if(p.dataset.avatar === currentUser.avatar_url) p.classList.add('selected');
    });

    await checkAndLoadDailyAttempts(user.id);
    loadMyPrizes();
    
    if (attemptsLeft > 0 && !timeUnlock) {
        await prepareNextPrize();
    }
}

// ==========================================================================
// EVENTOS Y MODALES
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
            .select('premios(id, nombre, rareza)')
            .eq('user_id', currentUser.id);

        if(error || !data || data.length === 0) {
            container.innerHTML = '<p class="empty-msg">Tu inventario está vacío de amuletos.</p>';
            return;
        }

        const contadores = {};
        TABLA_PREMIOS_LOCAL.forEach(p => { contadores[p.nombre] = 0; });

        data.forEach(item => {
            if (item.premios && item.premios.nombre) {
                contadores[item.premios.nombre] = (contadores[item.premios.nombre] || 0) + 1;
            }
        });

        container.innerHTML = TABLA_PREMIOS_LOCAL.map(p => {
            const cantidad = contadores[p.nombre] || 0;
            return `
                <div class="inventory-counter-card">
                    <span class="inv-name">${p.nombre}</span>
                    <span class="inv-qty">${cantidad}</span>
                </div>
            `;
        }).join('');

    } catch(e) {}
}

async function loadPrizesTodayList() {
    const list = document.getElementById('prizes-today-list');
    const hoy = new Date().toISOString().split('T')[0];

    try {
        const { data } = await supabaseClient
            .from('historial_premios')
            .select('premios(nombre, rareza)')
            .gte('ganado_at', `${hoy}T00:00:00Z`);

        if(!data || data.length === 0) {
            list.innerHTML = '<li>Nadie ha invocado la suerte hoy todavía.</li>';
            return;
        }

        const acumuladoHoy = {};
        TABLA_PREMIOS_LOCAL.forEach(p => { acumuladoHoy[p.nombre] = { cuenta: 0, rareza: p.rareza }; });

        data.forEach(item => {
            if (item.premios && item.premios.nombre) {
                if(!acumuladoHoy[item.premios.nombre]) {
                    acumuladoHoy[item.premios.nombre] = { cuenta: 0, rareza: item.premios.rareza || 'Común' };
                }
                acumuladoHoy[item.premios.nombre].cuenta++;
            }
        });

        list.innerHTML = TABLA_PREMIOS_LOCAL.map(p => {
            const datos = acumuladoHoy[p.nombre];
            return `
                <li class="summary-prize-row border-${datos.rareza.toLowerCase()}">
                    <strong>${p.nombre}</strong>
                    <span class="summary-count-badge">${datos.cuenta} x</span>
                </li>
            `;
        }).join('');
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
