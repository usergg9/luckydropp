// ==========================================================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================================================
const SUPABASE_URL = "https://ybsrkghhgurjgrfukgox.supabase.co";
const SUPABASE_KEY = "sb_publishable_gxjNTA6NmdNdyt46l11XBg_3NlCFRrX";

// Inicializamos el cliente de Supabase
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================================================
// ESTADO GLOBAL DEL JUEGO
// ==========================================================================
let currentUser = null;
let currentPrize = null;
let attemptsLeft = 3;
let isScratchedEnough = false; // Controla si se ha rascado el >1%
let gamePhase = "scratch"; // "scratch" (rascar), "claim" (listo para canjear), "reset" (volver a rascar)

// Elementos del DOM del Juego
const canvas = document.getElementById('scratch-canvas');
const ctx = canvas.getContext('2d');
const actionBtn = document.getElementById('action-btn');
const secretPrizeEl = document.getElementById('secret-prize');
const attemptCircles = document.querySelectorAll('.attempt-circle');

// ==========================================================================
// INICIALIZACIÓN AL CARGAR LA WEB
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
    initCanvas();
    setupEventListeners();
    
    // Comprobar si hay sesión activa
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        await handleUserLogin(session.user);
    } else {
        updateAttemptsUI();
        generateRandomPrizeLocal(); // Si no está logueado, genera uno ficticio
    }

    // Cargar contadores globales en tiempo real
    loadGlobalCounters();
    // Escuchar cambios en tiempo real
    listenToRealtimeChanges();
});

// ==========================================================================
// MECÁNICA DEL LIZO / CANVAS (RASCA)
// ==========================================================================
function initCanvas() {
    // Forzar tamaño correcto del lienzo
    canvas.width = 320;
    canvas.height = 200;

    // Dibujar la capa gris para rascar
    ctx.fillStyle = '#64748b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Escribir el texto "Rasca aquí" centrado
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px Segoe UI';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ RASCA AQUÍ ⚡', canvas.width / 2, canvas.height / 2);

    isScratchedEnough = false;
    if(actionBtn) actionBtn.disabled = true;
}

let isDrawing = false;

function setupScratchEvents() {
    // Soporte para Ratón (PC) y Dedo (Móvil)
    const startScratch = () => { if(attemptsLeft > 0 && gamePhase === "scratch") isDrawing = true; };
    const endScratch = () => { 
        isDrawing = false; 
        if(attemptsLeft > 0 && gamePhase === "scratch") checkScratchPercentage();
    };
    
    canvas.addEventListener('mousedown', startScratch);
    canvas.addEventListener('touchstart', startScratch);

    canvas.addEventListener('mouseup', endScratch);
    canvas.addEventListener('touchend', endScratch);

    canvas.addEventListener('mousemove', scratch);
    canvas.addEventListener('touchmove', (e) => {
        scratch(e);
        e.preventDefault(); // Evita que la pantalla del móvil se mueva al rascar
    });
}

function scratch(e) {
    if (!isDrawing) return;

    // Obtener coordenadas correctas del toque o click
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Configuración del borrado estilo "círculo"
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2); // Radio de 20px para el dedo
    ctx.fill();
}

// Calcular si ya rascó al menos el 1%
function checkScratchPercentage() {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    let transparentPixels = 0;

    // El array de píxeles tiene 4 canales (R, G, B, Alpha). Revisamos el canal Alpha (transparencia)
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) transparentPixels++;
    }

    const percentage = (transparentPixels / (pixels.length / 4)) * 100;

    // Si ha rascado más del 1% (puedes subirlo a 10% o 20% si quieres que rasque más)
    if (percentage > 1.0 && !isScratchedEnough) {
        isScratchedEnough = true;
        gamePhase = "claim";
        actionBtn.disabled = false;
        actionBtn.textContent = "Canjear";
    }
}

// ==========================================================================
// LÓGICA DE PROBABILIDADES Y PREMIOS
// ==========================================================================
async function prepareNextPrize() {
    initCanvas();
    gamePhase = "scratch";
    actionBtn.textContent = "Canjear";
    actionBtn.disabled = true;

    // Conseguir los premios de la base de datos para calcular la probabilidad real
    const { data: premios, error } = await supabase.from('premios').select('*');
    
    if (error || !premios) {
        generateRandomPrizeLocal();
        return;
    }

    // Algoritmo de probabilidad acumulada (Ruleta)
    const random = Math.random() * 100;
    let acumulado = 0;
    
    for (let premio of premios) {
        acumulado += premio.probabilidad;
        if (random <= acumulado) {
            currentPrize = premio;
            break;
        }
    }

    // Pintar el premio de fondo de forma invisible
    secretPrizeEl.querySelector('.prize-rarity').textContent = currentPrize.rareza;
    secretPrizeEl.querySelector('.prize-rarity').className = `prize-rarity rarity-${currentPrize.rareza.toLowerCase()}`;
    secretPrizeEl.querySelector('.prize-name').textContent = currentPrize.nombre;
}

function generateRandomPrizeLocal() {
    // Respaldo en memoria local por si falla Supabase o no hay internet
    currentPrize = { id: 1, nombre: "Trébol de 4 Hojas", rareza: "Común" };
    secretPrizeEl.querySelector('.prize-name').textContent = currentPrize.nombre;
}

// ==========================================================================
// CONTROL DE INTENTOS / VIDAS DIARIAS
// ==========================================================================
async function checkAndLoadDailyAttempts(userId) {
    const hoy = new Date().toISOString().split('T')[0];

    // Intentar buscar los intentos de hoy
    let { data, error } = await supabase
        .from('intentos_diarios')
        .select('*')
        .eq('user_id', userId)
        .eq('fecha', hoy)
        .single();

    if (error && error.code === 'PGRST116') {
        // No existe fila para hoy, la creamos desde cero (Regeneración de vidas diarias)
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
        actionBtn.textContent = "Sin intentos hoy";
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

// ==========================================================================
// PROCESO DE CANJEAR PREMIO
// ==========================================================================
async function claimPrize() {
    // Guardián de seguridad: Verificar si está registrado
    if (!currentUser) {
        alert("⚠️ ¡Atención! Debes registrarte o iniciar sesión en esta web antes de poder canjear tu amuleto.");
        return;
    }

    if (attemptsLeft <= 0) return;

    // 1. Guardar en el historial de premios del usuario
    await supabase.from('historial_premios').insert([
        { user_id: currentUser.id, premio_id: currentPrize.id }
    ]);

    // 2. Descontar una vida en la base de datos
    attemptsLeft--;
    const hoy = new Date().toISOString().split('T')[0];
    await supabase
        .from('intentos_diarios')
        .update({ intentos_restantes: attemptsLeft })
        .eq('user_id', currentUser.id)
        .eq('fecha', hoy);

    updateAttemptsUI();
    loadMyPrizes(); // Recargar pestaña "Mis Premios"

    // 3. Modificar el botón a "Volver a rascar" si le quedan vidas
    if (attemptsLeft > 0) {
        gamePhase = "reset";
        actionBtn.textContent = "Volver a rascar";
    } else {
        actionBtn.textContent = "Mañana más";
        actionBtn.disabled = true;
    }
}

// ==========================================================================
// AUTENTICACIÓN (LOGIN, REGISTRO, AVATARES)
// ==========================================================================
async function handleUserLogin(user) {
    currentUser = user;
    
    // Obtener su perfil público (username y avatar)
    let { data: perfil } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
    
    if (!perfil) {
        // Fallback por si acaso
        perfil = { username: user.email.split('@')[0], avatar_url: 'avatar1.png' };
    }

    currentUser.username = perfil.username;
    currentUser.avatar_url = perfil.avatar_url;

    // Cambiar UI de la interfaz
    document.getElementById('auth-logged-out').classList.add('hidden');
    document.getElementById('auth-logged-in').classList.remove('hidden');
    document.getElementById('display-username').textContent = perfil.username;
    
    // Cambiar el emoji/imagen del círculo superior izquierdo según el avatar guardado
    updateProfileCircleIcon(perfil.avatar_url);

    // Cargar sus intentos y su historial de amuletos
    await checkAndLoadDailyAttempts(user.id);
    loadMyPrizes();
    prepareNextPrize();
}

function updateProfileCircleIcon(avatarUrl) {
    const imgEl = document.getElementById('current-avatar');
    // Buscamos cuál emoji le corresponde en nuestra lista visual de 10 avatares
    const options = Array.from(document.querySelectorAll('.avatar-option'));
    const found = options.find(o => o.dataset.avatar === avatarUrl);
    if(found) {
        imgEl.style.display = 'none';
        // Convertimos el círculo en texto gigante para el emoji provisionalmente
        document.getElementById('profile-btn').textContent = found.textContent.trim().substring(0,2);
    }
}

// ==========================================================================
// EVENTOS DE NAVEGACIÓN Y VENTANAS (MODALES)
// ==========================================================================
function setupEventListeners() {
    setupScratchEvents();

    // Botón de acción principal (Canjear / Volver a rascar)
    actionBtn.addEventListener('click', () => {
        if (gamePhase === "claim") {
            claimPrize();
        } else if (gamePhase === "reset") {
            prepareNextPrize();
        }
    });

    // Control de Modales (Abrir y Cerrar)
    setupModal('profile-btn', 'modal-profile', '.close-btn');
    setupModal('live-prizes-btn', 'modal-prizes-today', '.close-prizes-today-btn', loadPrizesTodayList);
    setupModal('legendary-winners-btn', 'modal-legendary', '.close-legendary-btn', loadLegendaryWinnersList);
    
    // Submodales internos del Perfil
    setupModal('btn-open-avatars', 'modal-avatars', '.close-sub-btn');
    
    // Botones de login y registro abren el mismo formulario configurado dinámicamente
    document.getElementById('btn-show-login').addEventListener('click', () => openAuthForm('login'));
    document.getElementById('btn-show-register').addEventListener('click', () => openAuthForm('register'));
    document.querySelector('.close-auth-form-btn').addEventListener('click', () => document.getElementById('modal-auth-form').style.display = 'none');

    // Manejo del formulario de Login / Registro enviado
    document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);

    // Botón cerrar sesión
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.reload();
    });

    // Cambiar Avatar al hacer clic en uno de los 10
    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.addEventListener('click', async () => {
            if(!currentUser) return alert("Inicia sesión primero.");
            const selectedAvatar = opt.dataset.avatar;
            
            await supabase.from('usuarios').update({ avatar_url: selectedAvatar }).eq('id', currentUser.id);
            window.location.reload();
        });
    });
}

function setupModal(triggerId, modalId, closeClass, onOpenCallback = null) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    const closeBtn = modal.querySelector(closeClass);

    trigger.addEventListener('click', () => {
        modal.style.display = 'flex';
        if (onOpenCallback) onOpenCallback();
    });
    closeBtn.addEventListener('click', () => modal.style.display = 'none');
}

function openAuthForm(mode) {
    const modal = document.getElementById('modal-auth-form');
    const title = document.getElementById('auth-form-title');
    const usernameField = document.getElementById('username-field');
    
    modal.style.display = 'flex';
    modal.dataset.mode = mode;

    if (mode === 'register') {
        title.textContent = "Registrar Nueva Cuenta";
        usernameField.classList.remove('hidden');
        document.getElementById('input-username').required = true;
    } else {
        title.textContent = "Iniciar Sesión";
        usernameField.classList.add('hidden');
        document.getElementById('input-username').required = false;
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('modal-auth-form').dataset.mode;
    const email = document.getElementById('input-email').value;
    const password = document.getElementById('input-password').value;
    const username = document.getElementById('input-username').value;

    if (mode === 'register') {
        // 1. Registro en Autenticación de Supabase
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return alert("Error al registrarse: " + error.message);

        if (data.user) {
            // 2. Crear fila espejo en la tabla pública de usuarios
            await supabase.from('usuarios').insert([
                { id: data.user.id, username: username, avatar_url: 'avatar1.png' }
            ]);
            alert("¡Registro exitoso! Ya puedes jugar.");
            handleUserLogin(data.user);
        }
    } else {
        // Iniciar Sesión
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return alert("Error de acceso: " + error.message);
        handleUserLogin(data.user);
    }

    document.getElementById('modal-auth-form').style.display = 'none';
    document.getElementById('modal-profile').style.display = 'none';
}

// ==========================================================================
// CONSULTAS DINÁMICAS Y REALTIME (CONTADORES Y PESTAÑAS)
// ==========================================================================
async function loadGlobalCounters() {
    const hoy = new Date().toISOString().split('T')[0];

    // Contador 1: Premios de hoy en tiempo real
    const { count: countToday } = await supabase
        .from('historial_premios')
        .select('*', { count: 'exact', head: true })
        .gte('ganado_at', `${hoy}T00:00:00Z`);

    document.getElementById('count-prizes-today').textContent = countToday || 0;

    // Contador 2: Ganadores del premio Legendario (id: 7 del Maneki-Neko)
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
        container.innerHTML = '<p class="empty-msg">Aún no has ganado amuletos.</p>';
        return;
    }

    container.innerHTML = data.map(item => `
        <div class="prize-item">
            <span class="rarity-${item.premios.rareza.toLowerCase()}">🔮 ${item.premios.nombre}</span>
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
        list.innerHTML = '<li>Nadie ha canjeado amuletos hoy todavía. ¡Sé el primero!</li>';
        return;
    }

    list.innerHTML = data.map(item => `
        <li><strong>${item.usuarios?.username || 'Anónimo'}</strong> ha conseguido un(a) <em>${item.premios?.nombre}</em> hace un momento.</li>
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
        list.innerHTML = '<li>Nadie ha conseguido el Maneki-Neko de Oro todavía. ¿Lo lograrás tú?</li>';
        return;
    }

    list.innerHTML = data.map(item => `
        <li style="border-color: var(--legendary)">👑 <strong>${item.usuarios?.username || 'Invocador Místico'}</strong> obtuvo el Gran Maneki-Neko de Oro el ${new Date(item.ganado_at).toLocaleDateString()}.</li>
    `).join('');
}

// Activar la escucha en tiempo real de Supabase para actualizar los círculos superiores de inmediato
function listenToRealtimeChanges() {
    supabase
        .channel('schema-db-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'historial_premios' }, () => {
            loadGlobalCounters(); // Si alguien gana un premio en cualquier parte del mundo, refresca los marcadores
        })
        .subscribe();
}

// Iniciar el primer premio cargado listo
prepareNextPrize();
