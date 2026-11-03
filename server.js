const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const app = express();

app.use(express.json());

// Multi-matching CORS configuration to guarantee the security handshake passes
const allowedOrigins = [
    'https://neocities.org',
    'http://neocities.org',
    'https://neocities.org/',
    'http://neocities.org/'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // If the origin matches any of our variations, let it through
        if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('neocities.org')) {
            return callback(null, true);
        } else {
            return callback(null, new Error('CORS Policy Blocked Request'));
        }
    },
    credentials: true
}));

// Global rolling memory array to store chat logs
let chatHistory = [
    { id: 1, sender: 'TeleLink', text: 'Welcome to the live Netherlands Mesh feed!' }
];
let messageCounter = 2;
let lastBroadcastTime = 0;
const COOLDOWN_MS = 3 * 60 * 1000; // 3-minute transmission safety lock

// Connect to the Dutch Meshtastic MQTT Broker
const client = mqtt.connect('mqtt://mqtt.meshnet.nl');

client.on('connect', () => {
    console.log('Connected to mqtt.meshnet.nl successfully.');
    // Subscribe directly to the pre-decoded JSON channel wildcard stream for all NL text updates
    client.subscribe('msh/NL/json/#', (err) => {
        if (!err) console.log('Subscribed to translated text channel successfully');
    });
});

// Intercept plain-text messages instantly
client.on('message', (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        
        // Match standard Meshtastic plain-text json structure attributes
        if (payload.text || (payload.payload && payload.payload.text)) {
            const messageText = (payload.text || payload.payload.text).trim();
            const senderName = payload.fromStr || payload.from || (payload.payload && payload.payload.fromStr) || 'Unknown Node';

            // Skip reflecting our own outgoing messages
            if (senderName === 'TeleLink-BH') return;

            chatHistory.push({
                id: messageCounter++,
                sender: senderName,
                text: messageText,
                timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
            });

            if (chatHistory.length > 30) chatHistory.shift();
        }
    } catch (e) {
        // Skip malformed entries or telemetry events quietly
    }
});

// Root URL handler for Render's automated health check scan
app.get('/', (req, res) => {
    res.send('TeleLink Gateway is Online and Healthy!');
});

// Endpoint for Neocities to pull down active chat history
app.get('/api/history', (req, res) => {
    res.json(chatHistory);
});

// Endpoint to handle outbound web browser transmissions
app.post('/api/broadcast', (req, res) => {
    const now = Date.now();
    if (now - lastBroadcastTime < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - (now - lastBroadcastTime)) / 1000);
        return res.status(429).json({ error: `The airwaves are busy. Cooldown active: please wait ${waitSec} seconds.` });
    }

    const userMessage = req.body.message ? req.body.message.trim() : "";
    if (!userMessage || userMessage.length > 130) {
        return res.status(400).json({ error: 'Message must be between 1 and 130 characters.' });
    }

    lastBroadcastTime = now;

    // Send using clean text formatting directly into the LongFast text uplink
    const topic = "msh/NL/LongFast/uplink"; 
    const payload = {
        text: userMessage,
        fromStr: "TeleLink-BH"
    };

    client.publish(topic, JSON.stringify(payload), (err) => {
        if (!err) {
            res.json({ success: true, message: "Broadcasted successfully!" });
        } else {
            lastBroadcastTime = 0;
            res.status(500).json({ error: "Failed to forward packet to the mesh broker." });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Interactive Gateway running on port ${PORT}`));
