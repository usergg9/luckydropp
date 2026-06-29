// === CONFIGURACIÓN DE SUPABASE ===
const SUPABASE_URL = "https://ybsrkghhgurjgrfukgox.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_gxjNTA6NmdNdyt46l11XBg_3NlCFRrX";

const supabase = Supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === ESTADO DEL JUEGO ===
let currentUser = null;
let currentProfile = null;
let dailyAttemptsData = null;
let currentPrize = null;

let isDrawing = false;
let clearedPixels = 0;
const totalPixels = 300 * 150;
let prizeClaimed = false;
let gameActive = false;

// === AMULETOS Y PROBABILIDADES ===
const AMULETS = [
    { name: "Trébol de 3 Hojas", rarity: "Muy Común", weight: 50.0, color: "#a3a3a3" },
    { name: "Herradura de Hierro", rarity: "Común", weight: 25.0, color: "#a3a3a3" },
    { name: "Pata de Conejo de Felpa", rarity: "Poco Común", weight: 13.0, color: "#4ade80" },
    { name: "Escarabajo de Jaspilita", rarity: "Raro", weight: 7.0, color: "#60a5fa" },
    { name: "Ojo Turco de Cristal", rarity: "Épico", weight: 4.0, color: "#c084fc" },
    { name: "Moneda del Destino", rarity: "Megararo", weight: 0.9, color: "#f472b6" },
    { name: "Trébol de 4 Hojas Dorado", rarity: "Legendario", weight: 0.1, color: "#f4d160" }
];

const AVATARS = {
    1: "🦊", 2: "🐼", 3: "🦁", 4: "🐸", 5: "🐱", 6: "🐨", 7: "🐷", 8: "🐯", 9: "🐵", 10: "🦄"
};

// Elementos del DOM
const canvas = document.getElementById("scratch-canvas");
const ctx = canvas.getContext("2d");
const actionBtn = document.getElementById("action-btn");

// INICIALIZACIÓN
window.addEventListener("DOMContentLoaded", async () => {
    initCanvas();
    setupCanvasEvents();
    checkSession();
    updateGlobalStats();
});

// --- SISTEMA DEL RASCA (CANVAS) ---
function initCanvas() {
    ctx.fillStyle = "#888888";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Rasca aquí", canvas.width / 2, canvas.height / 2);
    
    clearedPixels = 0;
    prizeClaimed = false;
    actionBtn.innerText = "Canjear";
    actionBtn.disabled = true;
}

function setupCanvasEvents() {
    const startDrawing = () => { if(gameActive && !prizeClaimed) isDrawing = true; };
    const stopDrawing = () => { isDrawing = false; if(gameActive) checkScratchPercentage(); };
    
    canvas.addEventListener("mousedown", startDrawing);
    canvas.addEventListener("mouseup", stopDrawing);
    canvas.addEventListener("mousemove", scratch);

    canvas.addEventListener("touchstart", (e) => { startDrawing(); e.preventDefault(); });
    canvas.addEventListener("touchend", stopDrawing);
    canvas.addEventListener("touchmove", (e) => {
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        scratch({
            clientX: touch.clientX,
            clientY: touch.clientY,
            target: canvas
        });
        e.preventDefault();
    });
}

function scratch(e) {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
}

function checkScratchPercentage() {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparent = 0;
    for (let i = 3; i < imgData.data.length; i += 4) {
        if (imgData.data[i] === 0) transparent++;
    }
    
    // Al menos 1% rascado para habilitar canje
    if ((transparent / totalPixels) >= 0.01 && !prizeClaimed) {
        actionBtn.disabled = false;
    }
}

// --- LÓGICA DEL PREMIO (PROBABILIDADES) ---
function generateRandomPrize() {
    const rand = Math.random() * 100;
    let cumulative = 0;
    for (const prize of AMULETS) {
        cumulative += prize.weight;
        if (rand <= cumulative) return prize;
    }
    return AMULETS[0];
}

function prepareNewCard() {
    currentPrize = generateRandomPrize();
    const backName = document.getElementById("back-name");
    const backRarity = document.getElementById("back-rarity");
    
    backName.innerText = currentPrize.name;
    backRarity.innerText = currentPrize.rarity;
    backRarity.style.color = currentPrize.color;
    
    initCanvas();
}

// --- CONEXIÓN SUPABASE / USUARIOS ---
async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        await loadUserProfile();
        await syncDailyAttempts();
    } else {
        setGuestState();
    }
}

async function loadUserProfile() {
    const { data } = await supabase.from("profiles").select("*").eq("id", currentUser.id).single();
    currentProfile = data;
    document.getElementById("profile-btn").innerText = AVATARS[data.avatar_id] || "🦊";
    document.getElementById("logged-username").innerText = data.username;
    document.getElementById("auth-section").classList.add("hidden");
    document.getElementById("user-info-section").classList.remove("hidden");
}

function setGuestState() {
    gameActive = true;
    prepareNewCard();
    updateVidasUI(3);
}

async function syncDailyAttempts() {
    const todayStr = new Date().toISOString().split('T')[0];
    let { data } = await supabase.from("daily_attempts").select("*").eq("user_id", currentUser.id).single();
    
    if (!data) {
        // Inicializar vidas si es nuevo
        const { data: insertData } = await supabase.from("daily_attempts").insert({ user_id: currentUser.id }).select().single();
        data = insertData;
    } else if (data.last_played !== todayStr) {
        // Regeneración diaria de vidas
        const { data: updateData } = await supabase.from("daily_attempts").update({ attempts_left: 3, last_played: todayStr }).eq("user_id", currentUser.id).select().single();
        data = updateData;
    }
    
    dailyAttemptsData = data;
    updateVidasUI(data.attempts_left);
    
    if (data.attempts_left > 0) {
        gameActive = true;
        prepareNewCard();
    } else {
        gameActive = false;
        ctx.clearRect(0,0, canvas.width, canvas.height);
        ctx.fillStyle = "#333";
        ctx.fillRect(0,0, canvas.width, canvas.height);
        ctx.fillStyle = "#ff4444";
        ctx.fillText("Vuelve mañana", canvas.width/2, canvas.height/2);
    }
}

function updateVidasUI(vidas) {
    const circles = document.querySelectorAll(".life-circle");
    circles.forEach((c, idx) => {
        if (idx < vidas) c.classList.remove("disabled");
        else c.classList.add("disabled");
    });
}

// --- ACCIÓN DEL BOTÓN CANJEAR / VOLVER A RASCAR ---
actionBtn.addEventListener("click", async () => {
    if (!currentUser) {
        alert("Debe registrarse en esta web antes de canjear el premio");
        return;
    }

    if (!prizeClaimed) {
        // CANJEAR PREMIO
        prizeClaimed = true;
        actionBtn.disabled = true;
        
        // 1. Guardar premio en historial
        await supabase.from("user_prizes").insert({
            user_id: currentUser.id,
            prize_name: currentPrize.name,
            prize_rarity: currentPrize.rarity
        });

        // 2. Restar una vida
        const nuevasVidas = dailyAttemptsData.attempts_left - 1;
        await supabase.from("daily_attempts").update({ attempts_left: nuevasVidas }).eq("user_id", currentUser.id);
        
        dailyAttemptsData.attempts_left = nuevasVidas;
        updateVidasUI(nuevasVidas);
        updateGlobalStats();

        alert(`¡Has guardado con éxito tu amuleto: ${currentPrize.name}!`);
        actionBtn.innerText = "Volver a rascar";
        actionBtn.disabled = false;
    } else {
        // VOLVER A RASCAR
        if (dailyAttemptsData.attempts_left > 0) {
            prepareNewCard();
        } else {
            alert("No te quedan intentos por hoy. ¡Regresa mañana!");
            location.reload();
        }
    }
});

// --- CONTADORES EN TIEMPO REAL (ESTADÍSTICAS GLOBALES) ---
async function updateGlobalStats() {
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Premios de hoy
    const { count: countToday } = await supabase.from("user_prizes").select('*', { count: 'exact', head: true }).gte("won_at", todayStr);
    document.getElementById("stats-prizes-today").innerText = countToday || 0;

    // Ganadores legendarios (únicos)
    const { data: legData } = await supabase.from("user_prizes").select("user_id").eq("prize_rarity", "Legendario");
    const uniqueLegendaryUsers = new Set(legData?.map(item => item.user_id));
    document.getElementById("stats-legendary-users").innerText = uniqueLegendaryUsers.size || 0;
}

// --- MODALES Y FORMULARIOS ---
window.openModal = function(id) { document.getElementById(id).style.display = 'flex'; if(id === 'prizes-modal') loadUserPrizesList(); };
window.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };

// Registro
document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("reg-username").value;
    const email = document.getElementById("reg-email").value;
    const password = document.getElementById("reg-password").value;

    const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password });
    if (authErr) return alert(authErr.message);

    // Guardar perfil personalizado
    const { error: profErr } = await supabase.from("profiles").insert({ id: authData.user.id, username });
    if (profErr) return alert(profErr.message);

    alert("¡Cuenta creada! Ya puedes iniciar sesión.");
    closeModal("register-modal");
});

// Login
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);

    location.reload();
});

// Logout
document.getElementById("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.reload();
});

// Selección de Avatar
document.querySelectorAll(".avatar-item").forEach(item => {
    item.addEventListener("click", async () => {
        if (!currentUser) return alert("Regístrate primero para cambiar tu avatar.");
        const avatarId = item.getAttribute("data-id");
        
        await supabase.from("profiles").update({ avatar_id: avatarId }).eq("id", currentUser.id);
        document.getElementById("profile-btn").innerText = AVATARS[avatarId];
        closeModal("avatar-modal");
        alert("¡Avatar actualizado!");
    });
});

// Cargar lista de "Mis Premios"
async function loadUserPrizesList() {
    const list = document.getElementById("my-prizes-list");
    if (!currentUser) return;
    
    const { data } = await supabase.from("user_prizes").select("*").eq("user_id", currentUser.id).order("won_at", { ascending: false });
    list.innerHTML = data.length === 0 ? "<li>Aún no tienes amuletos. ¡A rascar!</li>" : data.map(p => `<li><strong>${p.prize_name}</strong> (${p.prize_rarity})</li>`).join("");
}

// Modales informativos superiores
document.getElementById("stats-prizes-today").addEventListener("click", () => {
    document.getElementById("info-modal-title").innerText = "⏰ Actividad de Hoy";
    document.getElementById("info-modal-body").innerText = "Este número indica la cantidad total de amuletos que se han rascado y reclamado en todo el mundo durante el día de hoy.";
    openModal("info-modal");
});

document.getElementById("stats-legendary-users").addEventListener("click", () => {
    document.getElementById("info-modal-title").innerText = "🏆 Salón de la Fama Legendario";
    document.getElementById("info-modal-body").innerText = "Muestra la cantidad de usuarios únicos en todo el juego que han tenido la inmensa fortuna de conseguir el mítico Trébol de 4 Hojas Dorado (0.1%).";
    openModal("info-modal");
});

document.getElementById("profile-btn").addEventListener("click", () => openModal("user-modal"));
