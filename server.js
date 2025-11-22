
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const os = require('os'); 

const app = express();
// Support cloud environment ports or default to 3000 for local
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARE: PERMISSIVE CORS ---
app.use((req, res, next) => {
    // Allow ANY origin (*). This is crucial for cloud deployment to work with any frontend.
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.header("Access-Control-Allow-Private-Network", "true"); 

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(bodyParser.json());

// --- CONFIGURATION (SANDBOX) ---
const CONSUMER_KEY = 'UnDvUCktXcQDyRScx0uAnJlA7rboMWhSnAxvhSOYQiX8QU0t';
const CONSUMER_SECRET = 'eP7nwvhM3OwL0nVhRlOCsGnRawPi32BkENmT33NygDpdYdq5sy1WyAshdCnidCkb';
const BUSINESS_SHORTCODE = '174379';
const PASSKEY = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const CALLBACK_URL = 'https://mydomain.com/mpesa-express-simulate/'; 

// --- HELPER: GENERATE TOKEN ---
async function getAccessToken() {
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

// --- HELPER: FORMAT TIMESTAMP (UTC+3) ---
function getTimestamp() {
    const now = new Date();
    const nairobiOffset = 3 * 60 * 60 * 1000; 
    const nairobiTime = new Date(now.getTime() + nairobiOffset);
    
    const year = nairobiTime.getUTCFullYear();
    const month = String(nairobiTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nairobiTime.getUTCDate()).padStart(2, '0');
    const hour = String(nairobiTime.getUTCHours()).padStart(2, '0');
    const minute = String(nairobiTime.getUTCMinutes()).padStart(2, '0');
    const second = String(nairobiTime.getUTCSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hour}${minute}${second}`;
}

// --- HELPER: GET LOCAL IP (For Local Dev Only) ---
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

// --- ROUTE: STATUS CHECK ---
// Handle root get for health check
app.get('/', (req, res) => {
    res.send('✅ BASI Backend is Online and Running!');
});
// Handle /stkpush get for health check as well (in case of reroute)
app.get('/stkpush', (req, res) => {
    res.send('✅ BASI Backend is Online and Running!');
});

// --- ROUTE: STK PUSH ---
// IMPORTANT: Listen on BOTH '/' and '/stkpush'. 
// Vercel rewrites often strip the path, sending the request to the root of the function.
app.post(['/', '/stkpush'], async (req, res) => {
    const { phone, amount } = req.body;
    console.log(`[${new Date().toLocaleTimeString()}] Payment Request: ${phone} - KES ${amount}`);

    if (!phone || !amount) {
        return res.status(400).json({ errorMessage: 'Phone and Amount are required' });
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
// Only run app.listen if running locally. 
// On Vercel, exporting 'app' allows the platform to handle the request.
if (require.main === module) {
    app.listen(PORT, () => {
        const localIp = getLocalIp();
        console.log(`\n🚀 BASI SERVER READY`);
        console.log(`--------------------------------------------------`);
        console.log(`🌍 Listening on Port: ${PORT}`);
        console.log(`💻 Local URL:      http://127.0.0.1:${PORT}/stkpush`);
        console.log(`📱 Network URL:    http://${localIp}:${PORT}/stkpush`);
        console.log(`--------------------------------------------------`);
    });
}

// Export for Vercel
module.exports = app;
