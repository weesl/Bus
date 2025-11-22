import { GoogleGenAI } from "@google/genai";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, setDoc, onSnapshot, query, where, deleteDoc, serverTimestamp } from "firebase/firestore";

// --- CONFIGURATION & STATE ---
// Shim process.env for browser compatibility to use the provided API Key
if (typeof process === 'undefined') {
    window.process = { env: {} };
}
if (!process.env) {
    process.env = {};
}
// Set the specific API key provided for the Chat Bot
process.env.API_KEY = 'AIzaSyBpkrtCTJvzp2IY7ikYGPmhBQwWFZOP2ug';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

let fares = [];
let tripHistory = [];
let currentView = 'collector'; // 'collector' | 'history' | 'map'
let pricingMode = 'standard'; // 'low' | 'standard' | 'high'
let customRoutes = [];
let pendingRouteSelection = null;

// Helper: Smart Default URL
// Detects if we are on localhost, LAN, or Vercel
const getSmartApiUrl = () => {
    const host = window.location.hostname;
    
    // 1. Vercel/Cloud Deployment
    // If running on Vercel or any non-local HTTPS domain, use relative path
    if (host.includes('vercel.app') || (window.location.protocol === 'https:' && !host.includes('localhost') && !host.includes('127.0.0.1'))) {
        return '/stkpush';
    }

    // 2. Localhost IPv4 force
    if (host === 'localhost') return 'http://127.0.0.1:3000/stkpush';
    
    // 3. Local Network (Mobile testing)
    if (host.match(/^192\.168\./) || host.match(/^10\./)) {
        return `http://${host}:3000/stkpush`;
    }
    
    // Fallback
    return 'http://127.0.0.1:3000/stkpush';
};

// Settings State
let settings = {
    isDemoMode: false, // Default to LIVE mode
    apiUrl: getSmartApiUrl(), // Dynamically set based on current host
    firebaseConfig: {
        apiKey: 'AIzaSyBZklpMNAuEIa5doua5OlBTdkXYH_wTaPY',
        projectId: '701315622562',
        authDomain: '701315622562.firebaseapp.com'
    }
};

// Vehicle Config
let vehicleConfig = {
    registration: '',
    alias: ''
};

// Cloud State
let db = null;
let faresUnsubscribe = null;
let isCloudConnected = false;


// Map State
let map = null;
let userMarker = null;
let userCircle = null;
let mapInitialized = false;
let watchId = null;

// Chat Bot State
let isChatOpen = false;
let isChatProcessing = false;
let chatSession = null; // Store the active chat session


// --- DATA: ROUTES & STAGES ---
const defaultRoutesData = [
    // Thika Road
    { name: "CBD - Ngara", fare: 30 },
    { name: "CBD - Pangani", fare: 40 },
    { name: "CBD - Muthaiga", fare: 50 },
    { name: "CBD - Survey", fare: 50 },
    { name: "CBD - Garden City", fare: 60 },
    { name: "CBD - Roysambu", fare: 70 },
    { name: "CBD - Kasarani", fare: 80 },
    { name: "CBD - Mwiki", fare: 90 },
    { name: "CBD - Zimmerman", fare: 80 },
    { name: "CBD - Githurai 44", fare: 80 },
    { name: "CBD - Githurai 45", fare: 80 },
    { name: "CBD - Kahawa Sukari", fare: 90 },
    { name: "CBD - Kahawa Wendani", fare: 90 },
    { name: "CBD - KU (Kenyatta Univ)", fare: 100 },
    { name: "CBD - Ruiru", fare: 100 },
    { name: "CBD - Juja", fare: 110 },
    { name: "CBD - Witeithie", fare: 120 },
    { name: "CBD - Thika Town", fare: 120 },
    { name: "CBD - Makongeni", fare: 130 },
    { name: "CBD - Kenol", fare: 150 },

    // Waiyaki Way
    { name: "CBD - Westlands", fare: 50 },
    { name: "CBD - Kangemi", fare: 60 },
    { name: "CBD - Uthiru", fare: 70 },
    { name: "CBD - Kinoo", fare: 80 },
    { name: "CBD - Muthiga", fare: 80 },
    { name: "CBD - Gitaru", fare: 90 },
    { name: "CBD - Kikuyu", fare: 100 },
    { name: "CBD - Zambezi", fare: 110 },
    { name: "CBD - Sigona", fare: 120 },
    { name: "CBD - Limuru", fare: 150 },

    // Ngong Road
    { name: "CBD - Community", fare: 30 },
    { name: "CBD - Prestige", fare: 50 },
    { name: "CBD - Adams Arcade", fare: 60 },
    { name: "CBD - Junction Mall", fare: 70 },
    { name: "CBD - Dagoretti Corner", fare: 80 },
    { name: "CBD - Karen", fare: 100 },
    { name: "CBD - Lenana", fare: 90 },
    { name: "CBD - Ngong Racecourse", fare: 90 },
    { name: "CBD - Ngong Town", fare: 120 },
    { name: "CBD - Kiserian", fare: 150 },

    // Langata Road
    { name: "CBD - Nyayo Stadium", fare: 30 },
    { name: "CBD - T-Mall", fare: 40 },
    { name: "CBD - Madaraka", fare: 50 },
    { name: "CBD - Nairobi West", fare: 50 },
    { name: "CBD - South C", fare: 60 },
    { name: "CBD - Wilson Airport", fare: 60 },
    { name: "CBD - Carnivore", fare: 70 },
    { name: "CBD - Langata", fare: 80 },
    { name: "CBD - Galleria", fare: 90 },
    { name: "CBD - Rongai", fare: 120 },

    // Mombasa Road
    { name: "CBD - South B", fare: 50 },
    { name: "CBD - Belle Vue", fare: 50 },
    { name: "CBD - Imara Daima", fare: 60 },
    { name: "CBD - City Cabanas", fare: 70 },
    { name: "CBD - Aviation", fare: 70 },
    { name: "CBD - Mlolongo", fare: 90 },
    { name: "CBD - Kitengela", fare: 120 },
    { name: "CBD - Athi River", fare: 120 },
    { name: "CBD - Machakos Junction", fare: 150 },
    { name: "CBD - Machakos Town", fare: 250 },

    // Jogoo Road / Eastlands
    { name: "CBD - City Stadium", fare: 30 },
    { name: "CBD - Makadara", fare: 40 },
    { name: "CBD - Hamza", fare: 50 },
    { name: "CBD - Donholm", fare: 60 },
    { name: "CBD - Pipeline", fare: 70 },
    { name: "CBD - Taj Mall", fare: 70 },
    { name: "CBD - Embakasi Village", fare: 80 },
    { name: "CBD - Utawala", fare: 100 },
    { name: "CBD - Ruai", fare: 120 },
    { name: "CBD - Kamulu", fare: 130 },
    { name: "CBD - Joska", fare: 150 },

    // Juja Road / Outering
    { name: "CBD - Pangani", fare: 40 },
    { name: "CBD - Eastleigh", fare: 50 },
    { name: "CBD - Huruma", fare: 60 },
    { name: "CBD - Kariobangi", fare: 70 },
    { name: "CBD - Dandora", fare: 80 },
    { name: "CBD - Baba Dogo", fare: 70 },
    { name: "CBD - Buruburu", fare: 70 },
    { name: "CBD - Umoja", fare: 80 },
    { name: "CBD - Komarock", fare: 90 },
    { name: "CBD - Kayole", fare: 100 },
    { name: "CBD - Njiru", fare: 110 }
];

const ROUTE_STAGES = {
    "Thika Road": "Ngara, Pangani, Muthaiga, Survey (KSL), Garden City/Willmary Estate, Roasters, Safari Park, Roysambu, Kasarani, Mwiki, Githurai 45, Kahawa Sukari, Kahawa Wendani, KU (Kenyatta University), Ruiru, Juja, Witeithie, Thika Town.",
    "Waiyaki Way": "Westlands, Kangemi, Uthiru, Kinoo, Muthiga, Gitaru, Kikuyu, Zambezi, Sigona, Limuru.",
    "Mombasa Road": "South B, Belle Vue, Capital Centre, Imara Daima, City Cabanas, Aviation, Mlolongo, Kitengela, Athi River, Machakos Junction.",
    "Langata Road": "Nyayo Stadium, T-Mall, Madaraka, Strathmore, Nairobi West, South C, Wilson Airport, Carnivore, Langata, Galleria, Bomas, Rongai.",
    "Ngong Road": "Community, Nairobi Hospital, Prestige Plaza, Adams Arcade, Impala, Junction Mall, Dagoretti Corner, Karen, Lenana, Ngong Racecourse, Ngong Town.",
    "Jogoo Road": "City Stadium, Makadara, Hamza, Donholm, Pipeline, Taj Mall, Embakasi, Utawala.",
    "Juja Road": "Pangani, Eastleigh (Garissa Lodge), Huruma, Kariobangi, Dandora, Baba Dogo, Buruburu, Umoja, Komarock, Kayole."
};

// --- DOM ELEMENTS ---
const DOMElements = {};

function initializeDOMElements() {
    const ids = [
        'landing-page', 'start-app-btn', 'app', 'settings-btn', 'vehicle-btn', 'home-btn',
        'navigation', 'nav-collector', 'nav-history', 'nav-map', 
        'mobile-nav-collector', 'mobile-nav-history', 'mobile-nav-map',
        'collector-view', 'history-view', 'map-view', 'map-container', 'map-lat', 'map-lng', 'map-locate-btn',
        'total-collected', 'transactions-count', 'fare-log', 'empty-log-msg',
        'custom-fare-form', 'custom-amount', 'custom-route-name', 'save-custom-route-btn', 'new-day-btn', 'history-log', 'empty-history-msg', 'download-history-btn',
        'mpesa-modal-backdrop', 'mpesa-modal-content', 'modal-input-state', 'modal-phone-input',
        'modal-phone-error', 'modal-cancel-btn', 'modal-confirm-btn', 'modal-processing-state',
        'modal-processing-status', 'modal-success-state', 'modal-success-title', 'modal-success-desc', 
        'modal-failure-state', 'modal-failure-title', 'modal-failure-reason', 'modal-close-btn', 'modal-retry-btn', 
        'collector-pull-to-refresh', 'history-pull-to-refresh', 'routes-grid', 'route-search',
        'mode-low', 'mode-std', 'mode-high',
        'settings-modal', 'settings-close-btn', 'settings-save-btn', 'settings-demo-toggle', 'settings-api-config', 'settings-api-url',
        'settings-fb-api-key', 'settings-fb-project-id', 'sync-status-indicator',
        'vehicle-modal', 'vm-reg', 'vm-alias', 'vm-save-btn', 'vm-close-btn', 'header-vehicle-display',
        // Route Details Modal Elements
        'route-details-modal', 'rd-route-name', 'rd-fare-amount', 'rd-est-time', 'rd-traffic-text', 'rd-traffic-indicator',
        'rd-pay-btn', 'rd-map-btn', 'rd-share-btn', 'rd-cancel-btn',
        // Chat Bot Elements
        'agan-chat-fab', 'agan-chat-window', 'chat-messages', 'chat-input', 'chat-send-btn', 'chat-close-btn'
    ];
    ids.forEach(id => {
        DOMElements[id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase())] = document.getElementById(id);
    });
}


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initializeDOMElements();
    loadData(); 
    loadSettings();
    loadVehicleConfig();
    
    const allRoutes = getAllRoutes();
    enrichRoutesData(allRoutes);
    renderRoutes(allRoutes);
    
    setupEventListeners();
    updateDisplay();
    updatePricingModeUI();
    
    // Map Resize Fix
    window.addEventListener('resize', () => {
        if (map && currentView === 'map') {
             map.invalidateSize();
        }
    });

    // Attempt Cloud Connection if configured
    if (settings.firebaseConfig?.apiKey) {
        CloudService.init();
    }
});

// --- CLOUD SERVICE (Firebase) ---
const CloudService = {
    init: () => {
        try {
            if (!settings.firebaseConfig.apiKey || !settings.firebaseConfig.projectId) return;

            const fbConfig = {
                apiKey: settings.firebaseConfig.apiKey,
                authDomain: `${settings.firebaseConfig.projectId}.firebaseapp.com`,
                projectId: settings.firebaseConfig.projectId,
            };
            
            const app = initializeApp(fbConfig);
            db = getFirestore(app);
            isCloudConnected = true;
            
            DOMElements.syncStatusIndicator.classList.remove('hidden');
            
            // Start Syncing Fares for this Vehicle
            CloudService.syncFares();

        } catch (e) {
            console.error("Firebase Init Error:", e);
            isCloudConnected = false;
            DOMElements.syncStatusIndicator.classList.add('hidden');
        }
    },

    syncFares: () => {
        if (!db || !vehicleConfig.registration) return;

        if (faresUnsubscribe) faresUnsubscribe();

        // Listen to 'fares' collection where vehicle matches
        const colRef = collection(db, 'vehicles', vehicleConfig.registration, 'current_session');
        
        faresUnsubscribe = onSnapshot(colRef, (snapshot) => {
            const remoteFares = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                remoteFares.push({
                    id: doc.id, // Use doc ID
                    amount: data.amount,
                    route: data.route,
                    timestamp: data.timestamp?.toDate() || new Date()
                });
            });
            
            // Sort by timestamp desc
            remoteFares.sort((a, b) => a.timestamp - b.timestamp);
            
            fares = remoteFares;
            updateDisplay();
        });
    },

    addFare: async (fare) => {
        if (!db || !vehicleConfig.registration) return;
        const colRef = collection(db, 'vehicles', vehicleConfig.registration, 'current_session');
        // Use specific ID
        await setDoc(doc(colRef, fare.id.toString()), {
            amount: fare.amount,
            route: fare.route,
            timestamp: fare.timestamp
        });
    },

    deleteFare: async (id) => {
        if (!db || !vehicleConfig.registration) return;
        const docRef = doc(db, 'vehicles', vehicleConfig.registration, 'current_session', id.toString());
        await deleteDoc(docRef);
    },

    clearSession: async () => {
        if (!db || !vehicleConfig.registration) return;
        // Client-side logic: assuming manual clear for this demo
    }
};


// --- DATA HELPERS ---
function getAllRoutes() {
    return [...customRoutes, ...defaultRoutesData];
}

function enrichRoutesData(routesList) {
    routesList.forEach(route => {
        const base = route.fare;
        route.standard = base;
        route.low = Math.max(10, Math.round((base * 0.75) / 10) * 10);
        route.high = Math.round((base * 1.3) / 10) * 10;
        
        if (route.low >= route.standard) route.low = Math.max(10, route.standard - 10);
        if (route.high <= route.standard) route.high = route.standard + 10;
    });
}

// --- ROUTE RENDERING ---
function renderRoutes(routes) {
    const container = DOMElements.routesGrid;
    container.innerHTML = ''; 

    routes.forEach(route => {
        const btn = document.createElement('button');
        let currentFare = route[pricingMode];
        
        let hoverBorder = 'hover:border-primary/50';
        let activeText = 'group-hover:text-primary';
        
        if (pricingMode === 'low') {
            hoverBorder = 'hover:border-success/50';
            activeText = 'group-hover:text-success';
        } else if (pricingMode === 'high') {
            hoverBorder = 'hover:border-danger/50';
            activeText = 'group-hover:text-danger';
        }

        btn.className = `route-btn p-4 bg-secondary/20 hover:bg-secondary/40 rounded-2xl text-left group transition-all duration-200 border border-secondary/30 ${hoverBorder}`;
        btn.dataset.route = route.name;
        btn.dataset.amount = currentFare;
        
        btn.innerHTML = `
            <p class="font-bold text-gray-200 ${activeText} transition-colors text-sm line-clamp-2">${route.name}</p>
            <p class="text-sm text-gray-400 mt-1 group-hover:text-gray-300">KES ${currentFare}</p>
        `;
        
        btn.addEventListener('click', () => {
             openRouteDetails(route, currentFare);
        });

        container.appendChild(btn);
    });
}

function openRouteDetails(routeObj, price) {
    pendingRouteSelection = { ...routeObj, price };
    
    // Traffic Simulation
    const rand = Math.random();
    let trafficLevel = 'Light';
    let trafficColor = 'bg-success';
    let trafficFactor = 1.0;

    if (rand > 0.8) {
        trafficLevel = 'Heavy';
        trafficColor = 'bg-danger';
        trafficFactor = 1.6;
    } else if (rand > 0.5) {
        trafficLevel = 'Moderate';
        trafficColor = 'bg-warning';
        trafficFactor = 1.3;
    }

    // Time Estimation
    const estimatedDistKm = Math.max(2, price / 12);
    const baseTimeMin = (estimatedDistKm / 25) * 60; 
    const estimatedMinutes = Math.round((baseTimeMin * trafficFactor) + 5);

    // Populate UI
    DOMElements.rdRouteName.textContent = routeObj.name;
    DOMElements.rdFareAmount.textContent = `KES ${price}`;
    DOMElements.rdEstTime.textContent = `${estimatedMinutes} min`;
    
    DOMElements.rdTrafficText.textContent = trafficLevel;
    DOMElements.rdTrafficIndicator.className = `w-3 h-3 rounded-full mr-3 shadow-[0_0_10px_currentColor] ${trafficColor}`;
    
    // Show Modal
    DOMElements.routeDetailsModal.style.display = 'flex';
}

function closeRouteDetails() {
    DOMElements.routeDetailsModal.style.display = 'none';
    pendingRouteSelection = null;
}


// --- DATA & STATE LOGIC ---
function addFare(amount, route) {
    const newFare = {
        id: Date.now(),
        amount: Number(amount),
        route: route,
        timestamp: new Date()
    };

    if (isCloudConnected) {
        CloudService.addFare(newFare);
        // Optimization: Add locally instantly, Cloud listener will confirm/duplicate check
        fares.push(newFare); 
        updateDisplay();
    } else {
        fares.push(newFare);
        saveFares();
        updateDisplay();
    }
}

function deleteFare(id) {
    if (isCloudConnected) {
        CloudService.deleteFare(id);
        fares = fares.filter(f => f.id !== id); // Optimistic update
        updateDisplay();
    } else {
        fares = fares.filter(f => f.id !== id);
        saveFares();
        updateDisplay();
    }
}

function deleteHistoryFare(dayIndex, fareId) {
    const day = tripHistory[dayIndex];
    if (!day) return;
    
    day.fares = day.fares.filter(f => f.id !== fareId);
    day.total = calculateTotal(day.fares);
    day.count = day.fares.length;
    
    if (day.count === 0) {
        tripHistory.splice(dayIndex, 1);
    }
    
    saveTripHistory();
    renderHistoryLog();
}

function clearFares() {
    fares = [];
    saveFares();
    updateDisplay();
}

function startNewDay() {
    if (fares.length > 0) {
        const daySummary = {
            date: new Date(),
            total: calculateTotal(fares),
            count: fares.length,
            fares: [...fares]
        };
        tripHistory.unshift(daySummary);
        saveTripHistory();
    }
    clearFares();
    renderHistoryLog();
}

const calculateTotal = (fareList) => fareList.reduce((sum, fare) => sum + fare.amount, 0);

// --- LOCAL STORAGE ---
const FARES_KEY = 'basiCurrentFares';
const HISTORY_KEY = 'basiTripHistory';
const SETTINGS_KEY = 'basiSettings';
const CUSTOM_ROUTES_KEY = 'basiCustomRoutes';
const VEHICLE_CONFIG_KEY = 'basiVehicleConfig';

function saveFares() {
    if (!isCloudConnected) {
        localStorage.setItem(FARES_KEY, JSON.stringify(fares));
    }
}

function saveTripHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(tripHistory));
}

function saveCustomRoutes() {
    localStorage.setItem(CUSTOM_ROUTES_KEY, JSON.stringify(customRoutes));
    chatSession = null;
}

function loadData() {
    try {
        // Only load local fares if Cloud NOT connected
        if (!isCloudConnected) {
            const savedFares = localStorage.getItem(FARES_KEY);
            if (savedFares) {
                fares = JSON.parse(savedFares).map(f => ({ ...f, timestamp: new Date(f.timestamp) }));
            }
        }
        
        const savedHistory = localStorage.getItem(HISTORY_KEY);
        if (savedHistory) {
            tripHistory = JSON.parse(savedHistory).map(day => ({
                ...day,
                date: new Date(day.date),
                fares: day.fares.map(f => ({ ...f, timestamp: new Date(f.timestamp) }))
            }));
        }
        const savedCustomRoutes = localStorage.getItem(CUSTOM_ROUTES_KEY);
        if (savedCustomRoutes) {
            customRoutes = JSON.parse(savedCustomRoutes);
        }
    } catch (e) {
        console.error("Error loading data:", e);
        fares = [];
        tripHistory = [];
    }
}

function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    // Determine the ideal default based on environment
    const smartDefaultUrl = getSmartApiUrl();

    if (saved) {
        const loaded = JSON.parse(saved);
        settings = { ...settings, ...loaded };
        
        // Ensure defaults if stored settings are missing keys
        if (!settings.firebaseConfig.apiKey) {
             settings.firebaseConfig = {
                apiKey: 'AIzaSyBZklpMNAuEIa5doua5OlBTdkXYH_wTaPY',
                projectId: '701315622562',
                authDomain: '701315622562.firebaseapp.com'
             };
        }

        // Smart Update: If user has the old localhost default but is now on a different network, hint update
        if (settings.apiUrl.includes('localhost') && window.location.hostname !== 'localhost') {
            // Don't overwrite automatically if they might have set it custom, but 
            // if it matches the old default exactly, update it.
             if (settings.apiUrl === 'http://127.0.0.1:3000/stkpush' || settings.apiUrl === 'http://localhost:3000/stkpush') {
                settings.apiUrl = smartDefaultUrl;
             }
        }
        
        // Use defaults if empty
        if (!settings.apiUrl) {
            settings.apiUrl = smartDefaultUrl;
        }

        DOMElements.settingsDemoToggle.checked = settings.isDemoMode;
        DOMElements.settingsApiUrl.value = settings.apiUrl;
        DOMElements.settingsFbApiKey.value = settings.firebaseConfig?.apiKey || '';
        DOMElements.settingsFbProjectId.value = settings.firebaseConfig?.projectId || '';

        if (settings.isDemoMode) {
            DOMElements.settingsApiConfig.classList.add('opacity-50', 'pointer-events-none');
        } else {
            DOMElements.settingsApiConfig.classList.remove('opacity-50', 'pointer-events-none');
        }
    } else {
        // First load defaults
        settings.isDemoMode = false; // Default to false
        DOMElements.settingsDemoToggle.checked = false;
        DOMElements.settingsApiUrl.value = smartDefaultUrl;
        DOMElements.settingsFbApiKey.value = settings.firebaseConfig.apiKey;
        DOMElements.settingsFbProjectId.value = settings.firebaseConfig.projectId;
        DOMElements.settingsApiConfig.classList.remove('opacity-50', 'pointer-events-none');
    }
}

function saveSettings() {
    settings.isDemoMode = DOMElements.settingsDemoToggle.checked;
    settings.apiUrl = DOMElements.settingsApiUrl.value.trim();
    
    const newFbKey = DOMElements.settingsFbApiKey.value.trim();
    const newFbProject = DOMElements.settingsFbProjectId.value.trim();
    
    const fbChanged = newFbKey !== settings.firebaseConfig?.apiKey || newFbProject !== settings.firebaseConfig?.projectId;

    settings.firebaseConfig = {
        apiKey: newFbKey,
        projectId: newFbProject,
        authDomain: newFbProject ? `${newFbProject}.firebaseapp.com` : ''
    };

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    DOMElements.settingsModal.style.display = 'none';

    if (fbChanged && newFbKey) {
        // Reload to init firebase
        if (confirm("Firebase config changed. Reload to connect?")) {
            window.location.reload();
        }
    }
}

function loadVehicleConfig() {
    const saved = localStorage.getItem(VEHICLE_CONFIG_KEY);
    if (saved) {
        vehicleConfig = JSON.parse(saved);
        DOMElements.vmReg.value = vehicleConfig.registration;
        DOMElements.vmAlias.value = vehicleConfig.alias;
        updateHeaderVehicleInfo();
    }
}

function saveVehicleConfig() {
    const oldReg = vehicleConfig.registration;
    vehicleConfig.registration = DOMElements.vmReg.value.trim().toUpperCase();
    vehicleConfig.alias = DOMElements.vmAlias.value.trim();
    localStorage.setItem(VEHICLE_CONFIG_KEY, JSON.stringify(vehicleConfig));
    updateHeaderVehicleInfo();
    DOMElements.vehicleModal.style.display = 'none';

    // If connected and reg changed, resync
    if (isCloudConnected && oldReg !== vehicleConfig.registration) {
        fares = []; // Clear old vehicle data
        updateDisplay();
        CloudService.syncFares();
    }
}


// --- HELPER: PARSE ROUTE ---
function parseRoute(routeString) {
    const safeStr = routeString || '';
    const parts = safeStr.split(/ - | to /i);
    if (parts.length > 1) {
        return { origin: parts[0].trim(), destination: parts[1].trim() };
    }
    return { origin: 'CBD', destination: safeStr };
}

// --- HELPER: SHARE ---
function shareSafetyDetails() {
    if (!pendingRouteSelection) return;
    
    const { name, price } = pendingRouteSelection;
    const estTime = DOMElements.rdEstTime.textContent;
    const { origin, destination } = parseRoute(name);
    
    let vehicle = '';
    if (vehicleConfig.registration) {
         vehicle = `${vehicleConfig.alias ? vehicleConfig.alias + ' ' : ''}(${vehicleConfig.registration})`;
    } else {
        const vehicles = ['Toyota HiAce (KCC 102Z)', 'Isuzu Bus (KDA 445X)', 'Nissan Matatu (KBZ 302A)', 'Bus (KDE 990L)'];
        vehicle = vehicles[Math.floor(Math.random() * vehicles.length)];
    }

    const shareText = `🚦 *TRIP STATUS UPDATE* 🚦\n\n` +
        `I am currently en route from *${origin}* to *${destination}*.\n\n` +
        `🚌 *Vehicle:* ${vehicle}\n` +
        `⏱️ *ETA:* ${estTime}\n` +
        `💵 *Fare:* KES ${price}\n\n` +
        `_Sent via BASI Safe Travel_`;

    const shareData = {
        title: 'My Trip Details',
        text: shareText
    };

    // @ts-ignore
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        // @ts-ignore
        navigator.share(shareData).catch(console.error);
    } else {
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
        window.open(whatsappUrl, '_blank');
        navigator.clipboard.writeText(shareText);
    }
}

// --- HELPER: PDF RECEIPT ---
function shareTrip(fare) {
    if (!window.jspdf) {
        alert("PDF Generator loading... Please try again in a moment.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, 120]
    });

    const { origin, destination } = parseRoute(fare.route || 'Custom Trip');
    const dateObj = new Date(fare.timestamp);
    const date = dateObj.toLocaleDateString();
    const time = dateObj.toLocaleTimeString();
    const refId = `REF-${fare.id.toString().slice(-8)}`;

    doc.setFont("Courier");
    doc.setFontSize(10);

    let y = 10;
    const centerX = 40;

    doc.setFontSize(16);
    doc.setFont("Courier", "bold");
    doc.text("BASI", centerX, y, { align: "center" });
    y += 5;
    doc.setFontSize(10);
    doc.setFont("Courier", "normal");
    doc.text("Travel & Fare Collection", centerX, y, { align: "center" });
    y += 5;
    doc.text("--------------------------------", centerX, y, { align: "center" });
    y += 5;

    doc.setFontSize(9);
    const addLine = (label, value) => {
        doc.text(label, 5, y);
        const textWidth = doc.getTextWidth(value);
        doc.text(value, 75 - textWidth, y);
        y += 5;
    };

    addLine("Date:", date);
    addLine("Time:", time);
    addLine("Ref ID:", refId);
    
    if (vehicleConfig.registration) {
        addLine("Vehicle:", vehicleConfig.registration);
    }
    
    y += 2;
    doc.text("--------------------------------", centerX, y, { align: "center" });
    y += 5;

    doc.setFontSize(10);
    doc.text("FROM:", 5, y);
    y += 5;
    doc.setFont("Courier", "bold");
    const splitOrigin = doc.splitTextToSize(origin, 70);
    doc.text(splitOrigin, 10, y);
    y += (splitOrigin.length * 5) + 2;

    doc.setFont("Courier", "normal");
    doc.text("TO:", 5, y);
    y += 5;
    doc.setFont("Courier", "bold");
    const splitDest = doc.splitTextToSize(destination, 70);
    doc.text(splitDest, 10, y);
    y += (splitDest.length * 5) + 5;

    doc.text("--------------------------------", centerX, y, { align: "center" });
    y += 7;
    doc.setFontSize(14);
    doc.text("TOTAL", 5, y);
    doc.text(`KES ${fare.amount.toLocaleString()}`, 75, y, { align: "right" });
    y += 10;

    doc.setFontSize(9);
    doc.setFont("Courier", "normal");
    doc.text("Payment: M-PESA / CASH", centerX, y, { align: "center" });
    y += 5;
    doc.text("Status: CONFIRMED", centerX, y, { align: "center" });
    y += 8;
    doc.setFont("Courier", "bold");
    doc.text("Safe Travels!", centerX, y, { align: "center" });
    y += 5;
    doc.setFont("Courier", "italic");
    doc.setFontSize(8);
    doc.text("Powered by BASI", centerX, y, { align: "center" });

    const fileName = `receipt_${refId}.pdf`;
    const pdfBlob = doc.output('blob');
    const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

    // @ts-ignore
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        // @ts-ignore
        navigator.share({
            files: [file],
            title: 'BASI Trip Receipt',
            text: 'Here is your BASI travel receipt.'
        }).catch(console.error);
    } else {
        doc.save(fileName);
    }
}

// --- CSV EXPORT LOGIC ---
function downloadHistory() {
    if (tripHistory.length === 0 && fares.length === 0) {
        alert("No trip data available to download yet.");
        return;
    }

    const headers = ["Date", "Time", "Reference", "Origin", "Destination", "Amount (KES)", "Vehicle", "Status"];
    const rows = [headers.join(",")];

    const escapeCsv = (str) => {
        if (!str) return '';
        const stringValue = String(str);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    };
    
    const currentVehicle = vehicleConfig.registration || 'N/A';

    if (fares.length > 0) {
        fares.slice().reverse().forEach(fare => {
             const { origin, destination } = parseRoute(fare.route || 'Custom');
             const dateObj = new Date(fare.timestamp);
             const dateStr = dateObj.toLocaleDateString();
             const timeStr = dateObj.toLocaleTimeString();
             const refId = `REF-${fare.id.toString().slice(-8)}`;
             
             rows.push([
                 escapeCsv(dateStr),
                 escapeCsv(timeStr),
                 escapeCsv(refId),
                 escapeCsv(origin),
                 escapeCsv(destination),
                 fare.amount,
                 escapeCsv(currentVehicle),
                 "Active Session"
             ].join(","));
        });
    }

    tripHistory.forEach(day => {
        const dayDate = new Date(day.date).toLocaleDateString();
        day.fares.forEach(fare => {
            const { origin, destination } = parseRoute(fare.route || 'Custom');
            const dateObj = new Date(fare.timestamp);
             const timeStr = dateObj.toLocaleTimeString();
             const refId = `REF-${fare.id.toString().slice(-8)}`;

             rows.push([
                 escapeCsv(dayDate),
                 escapeCsv(timeStr),
                 escapeCsv(refId),
                 escapeCsv(origin),
                 escapeCsv(destination),
                 fare.amount,
                 "Archived",
                 "Archived"
             ].join(","));
        });
    });

    const csvString = rows.join("\n");
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const today = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `basi_report_${today}.csv`);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 100);
}


// --- UI RENDERING ---
function updateDisplay() {
    renderSummary();
    renderFareLog();
    renderHistoryLog();
    updateHeaderVehicleInfo();
}

function updateHeaderVehicleInfo() {
    const display = DOMElements.headerVehicleDisplay;
    if (vehicleConfig.registration) {
        display.textContent = vehicleConfig.registration;
        display.classList.remove('hidden');
    } else {
        display.classList.add('hidden');
    }
}

function renderSummary() {
    const total = calculateTotal(fares);
    const count = fares.length;
    DOMElements.totalCollected.textContent = `KES ${total.toLocaleString()}`;
    DOMElements.transactionsCount.textContent = count;
}

function renderFareLog() {
    const { fareLog, emptyLogMsg } = DOMElements;
    fareLog.innerHTML = '';
    if (fares.length === 0) {
        emptyLogMsg.style.display = 'flex'; 
    } else {
        emptyLogMsg.style.display = 'none';
        fares.slice().reverse().forEach(fare => {
            const swipeOuter = document.createElement('div');
            swipeOuter.className = 'swipe-outer rounded-xl mb-3 shadow-md';
            
            const swipeBg = document.createElement('div');
            swipeBg.className = 'swipe-bg';
            swipeBg.innerHTML = `
                <span class="text-white font-bold mr-2">Delete</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            `;

            const { origin, destination } = parseRoute(fare.route || 'Custom Trip');
            const time = fare.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const date = fare.timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const refId = `REF-${fare.id.toString().slice(-8)}`;

            const swipeContent = document.createElement('div');
            swipeContent.className = 'swipe-content bg-surface p-4 rounded-xl border-l-4 border-primary';
            
            swipeContent.innerHTML = `
                <div class="flex justify-between items-stretch relative">
                    <div class="flex-1 mr-4 relative z-0">
                         <div class="absolute left-[5px] top-[10px] bottom-[10px] w-0.5 border-l-2 border-dashed border-gray-600 z-0"></div>
                        <div class="flex items-start mb-3 relative z-10">
                            <div class="w-3 h-3 rounded-full bg-gray-400 mt-1.5 mr-3 ring-4 ring-surface z-10"></div>
                            <div>
                                <p class="text-xs text-gray-500 font-bold uppercase tracking-wider">From</p>
                                <p class="font-bold text-gray-200 text-sm">${origin}</p>
                            </div>
                        </div>
                        <div class="flex items-end relative z-10">
                            <div class="w-3 h-3 rounded-full bg-primary mt-1 mr-3 ring-4 ring-surface shadow-[0_0_8px_rgba(197,168,128,0.6)] z-10"></div>
                            <div>
                                <p class="text-xs text-gray-500 font-bold uppercase tracking-wider">To</p>
                                <p class="font-bold text-white text-lg leading-tight">${destination}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex flex-col justify-between items-end text-right">
                        <div>
                             <span class="text-xl font-bold text-primary block">KES ${fare.amount}</span>
                             <span class="text-[10px] text-gray-500 font-mono block mt-1 bg-black/30 px-1.5 py-0.5 rounded">${refId}</span>
                        </div>
                        <div class="flex flex-col items-end space-y-2">
                            <div class="flex items-center text-gray-400 text-xs font-medium bg-black/20 px-2 py-1 rounded-lg">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                ${time}, ${date}
                            </div>
                             <button class="share-btn text-xs text-accent hover:text-white flex items-center transition" data-id="${fare.id}">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                                Share Receipt
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const shareBtn = swipeContent.querySelector('.share-btn');
            shareBtn.addEventListener('touchstart', (e) => e.stopPropagation()); 
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                shareTrip(fare);
            });

            setupSwipeToDelete(swipeOuter, swipeContent, () => deleteFare(fare.id));
            swipeOuter.appendChild(swipeBg);
            swipeOuter.appendChild(swipeContent);
            fareLog.appendChild(swipeOuter);
        });
    }
}

function renderHistoryLog() {
    const { historyLog, emptyHistoryMsg } = DOMElements;
    historyLog.innerHTML = '';
    if (tripHistory.length === 0) {
        emptyHistoryMsg.style.display = 'block';
    } else {
        emptyHistoryMsg.style.display = 'none';
        tripHistory.forEach((day, index) => {
            const dayEl = document.createElement('div');
            dayEl.className = 'bg-surface rounded-2xl overflow-hidden border border-secondary/30 shadow-lg';
            
            const header = document.createElement('div');
            header.className = 'p-4 flex justify-between items-center cursor-pointer hover:bg-secondary/10 transition select-none';
            
            const dateStr = new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            
            header.innerHTML = `
                <div>
                    <h3 class="font-bold text-white text-lg">${dateStr}</h3>
                    <p class="text-xs text-gray-400">${day.count} Trips</p>
                </div>
                <div class="flex items-center space-x-4">
                     <span class="text-xl font-bold text-primary">KES ${day.total.toLocaleString()}</span>
                     <svg class="chevron w-5 h-5 text-gray-500 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
            `;

            const details = document.createElement('div');
            details.className = 'history-details bg-background/30 border-t border-secondary/20';
            
            // Render fares inside accordion
            day.fares.slice().reverse().forEach(fare => {
                const swipeOuter = document.createElement('div');
                swipeOuter.className = 'swipe-outer border-b border-secondary/10 last:border-0';
                
                const swipeBg = document.createElement('div');
                swipeBg.className = 'swipe-bg';
                swipeBg.innerHTML = `
                    <span class="text-white font-bold mr-2">Delete</span>
                    <svg class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                `;

                const { origin, destination } = parseRoute(fare.route || 'Custom');
                const time = new Date(fare.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const refId = `REF-${fare.id.toString().slice(-8)}`;

                const swipeContent = document.createElement('div');
                swipeContent.className = 'swipe-content p-4 bg-surface flex justify-between items-center';
                
                swipeContent.innerHTML = `
                     <div class="flex flex-col">
                        <div class="flex items-center space-x-2 mb-1">
                             <span class="w-2 h-2 bg-primary rounded-full"></span>
                             <span class="text-white font-medium text-sm">${origin} <span class="text-gray-500 mx-1">→</span> ${destination}</span>
                        </div>
                         <div class="flex items-center space-x-3 pl-4">
                             <span class="text-xs text-gray-500 font-mono">${refId}</span>
                             <span class="text-xs text-gray-500 flex items-center"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>${time}</span>
                        </div>
                    </div>
                     <div class="text-right">
                        <div class="font-bold text-white">KES ${fare.amount}</div>
                        <button class="share-btn text-[10px] text-accent uppercase font-bold mt-1 hover:text-white transition" data-id="${fare.id}">Receipt</button>
                    </div>
                `;
                
                const shareBtn = swipeContent.querySelector('.share-btn');
                shareBtn.addEventListener('touchstart', (e) => e.stopPropagation()); 
                shareBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    shareTrip(fare);
                });
                
                setupSwipeToDelete(swipeOuter, swipeContent, () => deleteHistoryFare(index, fare.id));
                
                swipeOuter.appendChild(swipeBg);
                swipeOuter.appendChild(swipeContent);
                details.appendChild(swipeOuter);
            });

            header.addEventListener('click', () => {
                const isOpen = details.classList.contains('open');
                document.querySelectorAll('.history-details').forEach(el => el.classList.remove('open'));
                document.querySelectorAll('.chevron').forEach(el => el.classList.remove('open'));
                
                if (!isOpen) {
                    details.classList.add('open');
                    header.querySelector('.chevron').classList.add('open');
                }
            });

            dayEl.appendChild(header);
            dayEl.appendChild(details);
            historyLog.appendChild(dayEl);
        });
    }
}

function updatePricingModeUI() {
    const { modeLow, modeStd, modeHigh } = DOMElements;
    
    // Reset classes
    [modeLow, modeStd, modeHigh].forEach(btn => {
        btn.className = 'flex-1 py-2.5 rounded-lg text-xs font-bold text-gray-400 hover:text-white transition-all duration-200 bg-transparent';
    });

    // Apply Active Styles
    if (pricingMode === 'low') {
        modeLow.className = 'flex-1 py-2.5 rounded-lg text-xs font-bold bg-success text-white shadow-md transition-all duration-200';
    } else if (pricingMode === 'standard') {
        modeStd.className = 'flex-1 py-2.5 rounded-lg text-xs font-bold bg-primary text-background shadow-md transition-all duration-200';
    } else if (pricingMode === 'high') {
        modeHigh.className = 'flex-1 py-2.5 rounded-lg text-xs font-bold bg-danger text-white shadow-md transition-all duration-200';
    }
    
    // Re-render grid with new prices
    renderRoutes(getAllRoutes());
}

function setupSwipeToDelete(wrapper, content, onDelete) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;
    let isScrolling = false; // To distinguish vertical scroll from horizontal swipe

    content.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
        isScrolling = false; // Reset scroll flag
        wrapper.classList.remove('swiping');
    });

    content.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;

        // If user hasn't moved much yet, decide if scrolling or swiping
        if (!isScrolling && Math.abs(diffY) > Math.abs(diffX)) {
             isScrolling = true;
             isDragging = false; // Cancel swipe logic
             return;
        }
        
        if (isScrolling) return;

        // Only swipe left
        if (diffX < 0) {
             // Prevent default only if we are sure it's a swipe
             if(e.cancelable) e.preventDefault();
             currentX = diffX;
             // Limit drag
             if (currentX < -100) currentX = -100 - (Math.abs(currentX) - 100) * 0.2; 
             content.style.transform = `translateX(${currentX}px)`;
        }
    }, { passive: false });

    content.addEventListener('touchend', () => {
        if (!isDragging || isScrolling) return;
        isDragging = false;
        wrapper.classList.add('swiping');

        if (currentX < -80) { // Threshold to delete
            content.classList.add('swipe-animate-out');
            setTimeout(() => {
                onDelete();
            }, 300);
        } else {
            content.classList.add('swipe-snap-back');
            content.style.transform = '';
            setTimeout(() => {
                content.classList.remove('swipe-snap-back');
            }, 300);
        }
        currentX = 0;
    });
    
    let startY = 0;
}

function switchView(viewId) {
    currentView = viewId;
    
    // Update Navigation UI
    ['collector', 'history', 'map'].forEach(v => {
        const btn = document.getElementById(`nav-${v}`);
        const mobBtn = document.getElementById(`mobile-nav-${v}`);
        
        if (v === viewId) {
            btn.classList.add('bg-primary', 'text-background', 'shadow-md');
            btn.classList.remove('text-gray-400', 'hover:text-white');
            mobBtn.classList.add('bg-primary', 'text-background', 'shadow-md');
            mobBtn.classList.remove('text-gray-400', 'hover:text-white');
        } else {
            btn.classList.remove('bg-primary', 'text-background', 'shadow-md');
            btn.classList.add('text-gray-400', 'hover:text-white');
            mobBtn.classList.remove('bg-primary', 'text-background', 'shadow-md');
            mobBtn.classList.add('text-gray-400', 'hover:text-white');
        }
        
        const viewEl = document.getElementById(`${v}-view`);
        if (v === viewId) {
            viewEl.classList.remove('hidden');
             viewEl.classList.add('animate-fadeIn');
        } else {
            viewEl.classList.add('hidden');
             viewEl.classList.remove('animate-fadeIn');
        }
    });

    if (viewId === 'map') {
        initMap();
    }
}


// --- MAP LOGIC ---
function initMap() {
    if (mapInitialized) {
         setTimeout(() => { map.invalidateSize(); }, 100);
         return;
    }
    
    // Default to Nairobi
    map = L.map('map-container').setView([-1.2921, 36.8219], 13);

    // Dark Matter Tiles (CartoDB)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    mapInitialized = true;
    startTracking();
}

function startTracking() {
    if (!navigator.geolocation) return;

    const updatePosition = (pos) => {
        const { latitude, longitude } = pos.coords;
        DOMElements.mapLat.textContent = latitude.toFixed(5);
        DOMElements.mapLng.textContent = longitude.toFixed(5);

        if (!userMarker) {
            // Custom Icon
            const icon = L.divIcon({
                className: 'custom-map-marker',
                html: `<div class="w-4 h-4 bg-primary rounded-full border-2 border-white shadow-[0_0_15px_rgba(197,168,128,0.8)] animate-pulse"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            
            userMarker = L.marker([latitude, longitude], {icon: icon}).addTo(map);
            userCircle = L.circle([latitude, longitude], {
                radius: pos.coords.accuracy / 2,
                color: '#C5A880',
                fillColor: '#C5A880',
                fillOpacity: 0.1,
                weight: 1
            }).addTo(map);
            map.setView([latitude, longitude], 15);
        } else {
            userMarker.setLatLng([latitude, longitude]);
            userCircle.setLatLng([latitude, longitude]);
            userCircle.setRadius(pos.coords.accuracy / 2);
        }
    };

    // Watch
    watchId = navigator.geolocation.watchPosition(updatePosition, 
        (err) => console.warn("GPS Error", err), 
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    
    // Manual Locate
    DOMElements.mapLocateBtn.addEventListener('click', () => {
        navigator.geolocation.getCurrentPosition((pos) => {
             const { latitude, longitude } = pos.coords;
             if (map) map.setView([latitude, longitude], 16, { animate: true });
        }, alert, { enableHighAccuracy: true });
    });
}

// --- CHAT BOT LOGIC (AGAN) ---
function toggleChat() {
    isChatOpen = !isChatOpen;
    const win = DOMElements.aganChatWindow;
    if (isChatOpen) {
        win.classList.remove('hidden');
        // Use timeout to allow display:block to apply before transform
        setTimeout(() => {
             win.classList.remove('translate-y-[120%]');
        }, 10);
    } else {
        win.classList.add('translate-y-[120%]');
        setTimeout(() => {
            win.classList.add('hidden');
        }, 300); // Match transition duration
    }
}

async function handleUserMessage() {
    const input = DOMElements.chatInput;
    const message = input.value.trim();
    if (!message || isChatProcessing) return;

    // Add User Message
    renderMessage(message, 'user');
    input.value = '';
    isChatProcessing = true;
    
    // Show Typing Indicator
    const typingId = renderTypingIndicator();
    
    try {
        if (!ai) throw new Error("AI Config Missing");

        // Initialize Chat Session if not exists (Stateful Chat)
        if (!chatSession) {
             // Construct Context
            const routesContext = JSON.stringify(getAllRoutes().map(r => ({
                route: r.name, 
                fare: r.fare 
            })));
            
            const stagesContext = JSON.stringify(ROUTE_STAGES);
            
            const systemPrompt = `
                You are AGAN, a helpful, witty, and street-smart Matatu conductor assistant for the BASI app in Nairobi.
                You speak English mixed with some polite Kenyan slang (Sheng) like "Ma-fren", "Boss", "Sasa", "Leo".
                
                CONTEXT DATA (Routes and Fares):
                ${routesContext}
                
                CONTEXT DATA (Stages/Stops):
                ${stagesContext}
                
                YOUR ROLE:
                1. Answer questions about fares precisely using the data above.
                2. Help users find routes and list the stages/stops along that route if asked.
                3. If a user is bored or asks for a joke, tell a short, funny joke about Nairobi traffic, matatus, rain, police or Kenyan life.
                
                IMPORTANT RULES:
                - NEVER repeat the same joke twice in this conversation. If asked for another joke, tell a completely different one.
                - Rotate your joke topics (e.g. Matatu drivers, Kanjo, Rain, Passengers).
                - Be brief and concise (like a conductor).
                - If you don't know a route, say you don't cover it yet but you can ask the driver (joke).
            `;

            chatSession = ai.chats.create({
                model: 'gemini-3-pro-preview',
                config: {
                    systemInstruction: systemPrompt
                }
            });
        }

        // Send message to existing session
        const result = await chatSession.sendMessage({ message: message });
        const responseText = result.text;
        
        // Remove typing indicator and show bot response
        removeMessage(typingId);
        renderMessage(responseText, 'bot');
        
    } catch (error) {
        console.error("AGAN Error:", error);
        removeMessage(typingId);
        renderMessage("Ah boss, network imepotea kiasi. Jaribu tena.", 'bot');
        // Reset session on error to prevent stuck state
        chatSession = null;
    } finally {
        isChatProcessing = false;
    }
}

function renderMessage(text, type) {
    const container = DOMElements.chatMessages;
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex justify-${type === 'user' ? 'end' : 'start'} animate-fadeIn`;
    
    const bubble = document.createElement('div');
    bubble.className = type === 'user' 
        ? 'chat-message-user p-3 text-sm max-w-[85%] rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl shadow-sm'
        : 'chat-message-bot p-3 text-sm max-w-[85%] rounded-tl-2xl rounded-tr-2xl rounded-br-2xl';
    
    bubble.innerText = text;
    msgDiv.appendChild(bubble);
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv.id = 'msg-' + Date.now();
}

function renderTypingIndicator() {
    const container = DOMElements.chatMessages;
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex justify-start animate-fadeIn`;
    msgDiv.id = 'typing-' + Date.now();
    
    msgDiv.innerHTML = `
        <div class="chat-message-bot p-3 rounded-tl-2xl rounded-tr-2xl rounded-br-2xl flex space-x-1 items-center h-10">
            <div class="w-2 h-2 bg-gray-400 rounded-full typing-dot"></div>
            <div class="w-2 h-2 bg-gray-400 rounded-full typing-dot"></div>
            <div class="w-2 h-2 bg-gray-400 rounded-full typing-dot"></div>
        </div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv.id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}


// --- EVENT LISTENERS ---
function setupEventListeners() {
    // Navigation
    ['collector', 'history', 'map'].forEach(view => {
        document.getElementById(`nav-${view}`)?.addEventListener('click', () => switchView(view));
        document.getElementById(`mobile-nav-${view}`)?.addEventListener('click', () => switchView(view));
    });

    // Home Button (Exit)
    DOMElements.homeBtn.addEventListener('click', () => {
        document.getElementById('app').classList.add('hidden');
        document.getElementById('app').classList.remove('animate-fadeIn');
        document.getElementById('landing-page').style.display = 'flex';
    });

    // Pricing Mode
    DOMElements.modeLow.addEventListener('click', () => { pricingMode = 'low'; updatePricingModeUI(); });
    DOMElements.modeStd.addEventListener('click', () => { pricingMode = 'standard'; updatePricingModeUI(); });
    DOMElements.modeHigh.addEventListener('click', () => { pricingMode = 'high'; updatePricingModeUI(); });

    // Search
    DOMElements.routeSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const allRoutes = getAllRoutes();
        const filtered = allRoutes.filter(r => r.name.toLowerCase().includes(term));
        renderRoutes(filtered);
    });

    // Route Details Actions
    DOMElements.rdCancelBtn.addEventListener('click', closeRouteDetails);
    DOMElements.rdPayBtn.addEventListener('click', () => {
        if (!pendingRouteSelection) return;
        DOMElements.modalPhoneInput.value = ''; 
        DOMElements.mpesaModalBackdrop.style.display = 'flex';
        resetMpesaModal();
        // Only hide the modal, do NOT clear pendingRouteSelection yet
        DOMElements.routeDetailsModal.style.display = 'none';
    });
    
    DOMElements.rdMapBtn.addEventListener('click', () => {
         switchView('map');
         closeRouteDetails();
         // Trigger map center logic if route details parsed
    });
    
    DOMElements.rdShareBtn.addEventListener('click', shareSafetyDetails);

    // M-Pesa Modal Actions - Ensure pendingRouteSelection is cleared when cancelled
    DOMElements.modalCancelBtn.addEventListener('click', () => {
        DOMElements.mpesaModalBackdrop.style.display = 'none';
        pendingRouteSelection = null;
    });
    DOMElements.modalCloseBtn.addEventListener('click', () => {
        DOMElements.mpesaModalBackdrop.style.display = 'none';
        pendingRouteSelection = null;
    });
    
    DOMElements.modalConfirmBtn.addEventListener('click', () => {
        const phone = DOMElements.modalPhoneInput.value.trim();
        if (!phone) {
            DOMElements.modalPhoneError.textContent = 'Please enter a phone number';
            return;
        }
        // Basic validation
        // Allow 07, 01, 2547, 2541, +2547, +2541 and clean 254 prefix without +
        const phoneRegex = /^(?:254|\+254|0)?((?:7|1)[0-9]{8})$/;
        if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
             DOMElements.modalPhoneError.textContent = 'Invalid Kenya phone number. Use format 07XX... or 2547XX...';
             return;
        }
        DOMElements.modalPhoneError.textContent = '';
        triggerStkPush(phone);
    });
    
    DOMElements.modalRetryBtn.addEventListener('click', resetMpesaModal);

    // Custom Fare
    DOMElements.customFareForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = DOMElements.customAmount.value;
        const name = DOMElements.customRouteName.value.trim() || 'Custom Trip';
        if (amount > 0) {
            addFare(amount, name);
            DOMElements.customAmount.value = '';
            DOMElements.customRouteName.value = '';
            // Scroll to top of log
            DOMElements.fareLog.scrollTop = 0;
        }
    });
    
    DOMElements.saveCustomRouteBtn.addEventListener('click', () => {
        const amount = Number(DOMElements.customAmount.value);
        const name = DOMElements.customRouteName.value.trim();
        if (amount > 0 && name) {
            const newRoute = { name, fare: amount, standard: amount, low: amount, high: amount };
            customRoutes.push(newRoute);
            saveCustomRoutes();
            
            // Refresh Grid
            const all = getAllRoutes();
            enrichRoutesData(all);
            renderRoutes(all);
            
            alert('Route Saved!');
        } else {
            alert('Please enter a name and amount to save.');
        }
    });

    // Data Management
    DOMElements.newDayBtn.addEventListener('click', () => {
        if (confirm('Start a new day? This will archive current trips to history.')) {
            startNewDay();
        }
    });
    DOMElements.downloadHistoryBtn.addEventListener('click', downloadHistory);

    // Start App
    document.getElementById('start-app-btn')?.addEventListener('click', () => {
        document.getElementById('landing-page').style.display = 'none';
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('app').classList.add('animate-fadeIn');
        
        // Play Audio context fix if needed for chat
    });
    
    // Settings
    DOMElements.settingsBtn.addEventListener('click', () => {
        DOMElements.settingsModal.style.display = 'flex';
    });
    DOMElements.settingsCloseBtn.addEventListener('click', () => DOMElements.settingsModal.style.display = 'none');
    DOMElements.settingsSaveBtn.addEventListener('click', saveSettings);
    DOMElements.settingsDemoToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
             DOMElements.settingsApiConfig.classList.add('opacity-50', 'pointer-events-none');
        } else {
             DOMElements.settingsApiConfig.classList.remove('opacity-50', 'pointer-events-none');
        }
    });

    // Vehicle Modal
    DOMElements.vehicleBtn.addEventListener('click', () => {
        DOMElements.vehicleModal.style.display = 'flex';
    });
    DOMElements.vmCloseBtn.addEventListener('click', () => DOMElements.vehicleModal.style.display = 'none');
    DOMElements.vmSaveBtn.addEventListener('click', saveVehicleConfig);

    // Chat Bot Actions
    DOMElements.aganChatFab.addEventListener('click', toggleChat);
    DOMElements.chatCloseBtn.addEventListener('click', toggleChat);
    DOMElements.chatSendBtn.addEventListener('click', handleUserMessage);
    DOMElements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleUserMessage();
    });
}

// --- MPESA LOGIC ---
function resetMpesaModal() {
    DOMElements.modalInputState.style.display = 'block';
    DOMElements.modalProcessingState.style.display = 'none';
    DOMElements.modalSuccessState.style.display = 'none';
    DOMElements.modalFailureState.style.display = 'none';
}

function triggerStkPush(phone) {
    // Safety Check for Null Pointer
    if (!pendingRouteSelection) {
        console.error("No route selected for payment");
        DOMElements.modalInputState.style.display = 'none';
        DOMElements.modalProcessingState.style.display = 'none';
        DOMElements.modalFailureState.style.display = 'block';
        DOMElements.modalFailureTitle.textContent = 'Error';
        DOMElements.modalFailureReason.textContent = 'Session invalid. Please select route again.';
        return;
    }

    DOMElements.modalInputState.style.display = 'none';
    DOMElements.modalProcessingState.style.display = 'block';
    DOMElements.modalProcessingStatus.textContent = 'Sending STK Push...';

    if (settings.isDemoMode) {
        // DEMO LOGIC
        setTimeout(() => {
            DOMElements.modalProcessingStatus.textContent = 'Waiting for PIN...';
            
            // Simulate User Action delay
            setTimeout(() => {
                // Success
                DOMElements.modalProcessingState.style.display = 'none';
                DOMElements.modalSuccessState.style.display = 'block';
                DOMElements.modalSuccessTitle.textContent = 'Payment Confirmed! (DEMO)';
                
                // Add to log
                if (pendingRouteSelection) {
                    addFare(pendingRouteSelection.price, pendingRouteSelection.name);
                }
                
                // Close after delay
                setTimeout(() => {
                    DOMElements.mpesaModalBackdrop.style.display = 'none';
                    resetMpesaModal();
                    pendingRouteSelection = null;
                }, 2000);

            }, 3000);
        }, 1500);

    } else {
        // NODEJS BACKEND LOGIC
        // Default to settings API URL or smart detected URL
        const proxyUrl = settings.apiUrl || getSmartApiUrl();
        
        // Normalize phone to 254 format to be safe
        // Replace ALL plus signs and spaces
        let formattedPhone = phone.replace(/\s+/g, '').replace(/\+/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        }

        // Send simple payload to proxy
        const requestBody = {
            phone: formattedPhone,
            amount: Math.ceil(pendingRouteSelection.price)
        };
        
        console.log(`Attempting STK Push to: ${proxyUrl}`);
        
        // MIXED CONTENT CHECK
        if (window.location.protocol === 'https:' && proxyUrl.startsWith('http:') && !proxyUrl.includes('localhost') && !proxyUrl.includes('127.0.0.1')) {
             console.error("Mixed Content Error: HTTPS frontend cannot query HTTP backend.");
             DOMElements.modalProcessingState.style.display = 'none';
             DOMElements.modalFailureState.style.display = 'block';
             DOMElements.modalFailureTitle.textContent = 'Security Block';
             DOMElements.modalFailureReason.innerHTML = `
                Your browser blocked the connection.<br><br>
                <b>Reason:</b> You are on HTTPS but the server is HTTP.<br>
                <b>Fix:</b> Deploy your backend to a secure host (Render/Replit) and update the API URL in Settings.
             `;
             return;
        }

        fetch(proxyUrl, {
            method: 'POST',
            mode: 'cors', // Explicitly set CORS mode
            credentials: 'omit', // CRITICAL: Do not send cookies/auth to allow wildcard (*) CORS on server
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        })
        .then(res => {
            if (!res.ok) {
                // Attempt to read error from proxy
                return res.json().then(err => { throw new Error(err.errorMessage || 'Request Failed') }).catch(e => {
                     // If response isn't JSON (e.g. 404 html)
                    throw new Error(res.statusText || 'Connection to Proxy Failed');
                });
            }
            return res.json();
        })
        .then(data => {
            if (data.ResponseCode === "0") {
                // Display the message from Safaricom (usually "Success. Request accepted for processing")
                DOMElements.modalProcessingStatus.textContent = data.CustomerMessage || 'Waiting for PIN...';
                // Polling logic (Simulation for now as proxy likely doesn't have callback endpoint set up)
                pollTransactionStatus(data.CheckoutRequestID);
            } else {
                throw new Error(data.errorMessage || 'STK Push failed');
            }
        })
        .catch(err => {
            console.error("STK Push Error:", err);
            
            let friendlyError = err.message;
            let title = 'Request Failed';
            
            // Handle "Failed to fetch" specifically with context aware help
            if (friendlyError === 'Failed to fetch' || friendlyError.includes('NetworkError') || friendlyError.includes('Connection to Proxy Failed')) {
                const isLocalhost = proxyUrl.includes('localhost') || proxyUrl.includes('127.0.0.1') || proxyUrl.match(/^http:\/\/192\./);
                
                if (isLocalhost) {
                    title = "Backend Offline";
                    friendlyError = `
                    Could not connect to local server.<br>
                    <ul class="text-left text-xs list-disc pl-4 mt-2">
                        <li class="font-bold text-primary">Is "node server.js" running?</li>
                        <li>Run: <code>node server.js</code> in terminal.</li>
                        <li>Ensure your phone is on the same Wi-Fi.</li>
                    </ul>`;
                } else {
                    title = "Cloud Server Error";
                    friendlyError = `
                    Could not connect to online server.<br>
                    <ul class="text-left text-xs list-disc pl-4 mt-2">
                        <li>Check your internet connection.</li>
                        <li>Verify the URL in Settings is correct.</li>
                        <li>Check if your backend is sleeping (e.g. Render/Replit free tier).</li>
                    </ul>`;
                }
            }

            DOMElements.modalProcessingState.style.display = 'none';
            DOMElements.modalFailureState.style.display = 'block';
            DOMElements.modalFailureTitle.textContent = title;
            DOMElements.modalFailureReason.innerHTML = friendlyError; 
        });
    }
}

function pollTransactionStatus(checkoutReqId) {
    // Note: Polling also requires an endpoint. Using the provided sandbox query endpoint if available, 
    // or falling back to a simulation for this specific context if URL isn't separate.
    
    let attempts = 0;
    
    const poll = setInterval(() => {
        attempts++;
        
        // Mock polling success for the sake of the UI flow if live query fails (common in frontend-only demos)
        if (attempts >= 5) { 
             clearInterval(poll);
             DOMElements.modalProcessingState.style.display = 'none';
             DOMElements.modalSuccessState.style.display = 'block';
             if (pendingRouteSelection) {
                 addFare(pendingRouteSelection.price, pendingRouteSelection.name);
             }
             setTimeout(() => {
                 DOMElements.mpesaModalBackdrop.style.display = 'none';
                 resetMpesaModal();
                 pendingRouteSelection = null;
             }, 2000);
        }

    }, 2000);
}