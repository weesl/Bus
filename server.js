
// Load environment variables from .env file if present (Local Development)
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const os = require('os'); 
const path = require('path');

const app = express();
// Support cloud environment ports or default to 3000 for local
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARE: PERMISSIVE CORS ---
app.use((req, res, next) => {
    // Allow ANY origin (*). This is crucial for cloud deployment.
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.header("Access-Control-Allow-Private-Network", "true"); 

    // Logger for debugging 'Failed to fetch'
    console.log(`[INCOMING] ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(bodyParser.json());

// --- SERVE STATIC FRONTEND ---
app.use(express.static(__dirname));

// --- CONFIGURATION ---
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const BUSINESS_SHORTCODE = process.env.MPESA_SHORTCODE || '174379';
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = 'https://mydomain.com/mpesa-express-simulate/'; 

// --- HELPER: GENERATE TOKEN ---
async function getAccessToken() {
    if (!CONSUMER_KEY || !CONSUMER_SECRET) {
        console.warn("WARNING: M-Pesa Keys missing.");
    }
    
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    try {
        const response = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { headers: { Authorization: `Basic ${auth}` } }
        );
        return response.data.access_token;
    } catch (error) {
        console.error("Token Error:", error.response ? error.response.data : error.message);
        throw new Error('Failed to generate access token');
    }
}

// --- HELPER: TIMESTAMP ---
function getTimestamp() {
    const now = new Date();
    const nairobiOffset = 3 * 60 * 60 * 1000; 
    const nairobiTime = new Date(now.getTime() + nairobiOffset);
    return nairobiTime.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

// --- HELPER: LOCAL IP ---
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if ('IPv4' !== iface.family || iface.internal) continue;
            return iface.address;
        }
    }
    return '127.0.0.1';
}

// --- ROUTE: ROOT / HEALTH ---
// This fixes Vercel 404s and allows easy testing
app.get('/', (req, res) => {
    res.send('✅ BASI Backend is Online and Running!');
});

app.get('/health', (req, res) => {
    res.send('OK');
});

// --- ROUTE: APP CONFIG ---
app.get('/config', (req, res) => {
    res.json({
        geminiApiKey: process.env.GEMINI_API_KEY || '',
        firebase: {
            apiKey: process.env.FIREBASE_API_KEY || '',
            projectId: process.env.FIREBASE_PROJECT_ID || ''
        }
    });
});

// --- ROUTE: STK PUSH ---
app.post('/stkpush', async (req, res) => {
    const { phone, amount } = req.body;
    console.log(`[PAYMENT] Request: ${phone} - KES ${amount}`);

    if (!phone || !amount) {
        return res.status(400).json({ errorMessage: 'Phone and Amount are required' });
    }

    if (!CONSUMER_KEY || !CONSUMER_SECRET || !PASSKEY) {
        console.error("Server Error: Keys not loaded.");
        return res.status(500).json({ errorMessage: 'Server Configuration Error: Missing M-Pesa Keys' });
    }

    let formattedPhone = phone.replace(/[\s+]/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.substring(1);
    else if (formattedPhone.length === 9) formattedPhone = '254' + formattedPhone;

    try {
        const accessToken = await getAccessToken();
        const timestamp = getTimestamp();
        const password = Buffer.from(`${BUSINESS_SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');

        const payload = {
            BusinessShortCode: BUSINESS_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: String(Math.ceil(amount)),
            PartyA: formattedPhone,
            PartyB: BUSINESS_SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: CALLBACK_URL,
            AccountReference: "BASI FARE",
            TransactionDesc: "Fare Payment"
        };

        const response = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            payload,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        console.log(" > Success:", response.data.CustomerMessage);
        res.json(response.data);

    } catch (error) {
        const errData = error.response ? error.response.data : error.message;
        console.error(" > Error:", JSON.stringify(errData));
        res.status(500).json({ errorMessage: 'Safaricom API Error', details: errData });
    }
});

// --- START SERVER ---
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 BASI SERVER READY`);
        console.log(`🌍 Listening on Port: ${PORT}`);
        console.log(`💻 Link: http://127.0.0.1:${PORT}`);
        
        // Key Status Check
        const mpesaStatus = (process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET) ? "OK" : "MISSING";
        const geminiStatus = process.env.GEMINI_API_KEY ? "OK" : "MISSING";
        const firebaseStatus = process.env.FIREBASE_PROJECT_ID ? "OK" : "MISSING";
        
        console.log(`✅ Keys Status: M-Pesa [${mpesaStatus}] | Gemini [${geminiStatus}] | Firebase [${firebaseStatus}]`);
    });
}

module.exports = app;
