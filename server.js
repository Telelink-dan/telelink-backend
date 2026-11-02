const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const app = express();

app.use(express.json());

// Enable CORS for your exact Neocities subdomain layout
app.use(cors({
    origin: 'https://telelink.neocities.org'
}));

// Global variable arrays to store rolling logs
let chatHistory = [
    { id: 1, sender: 'TeleLink', text: 'Welcome to the live Netherlands Mesh feed!' }
];
let messageCounter = 2;
let lastBroadcastTime = 0;
const COOLDOWN_MS = 3 * 60 * 1000; // 3-minute transmission safety lock

// Connect to the Dutch Meshtastic MQTT Broker
const client = mqtt.connect('mqtt://mqtt.meshnet.nl');

client.on('connect', () => {
    console.log('Connected to mqtt.meshnet.nl');
    // Subscribe to JSON broadcast feed for the entire country
    client.subscribe('msh/NL/LongFast/json', (err) => {
        if (!err) console.log('Subscribed to national JSON chat feed');
    });
});

// Listen for incoming messages from across the country
client.on('message', (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        
        // Ensure it contains a text payload message string
        if (payload.type === 'text' && payload.payload?.text) {
            const senderName = payload.payload.fromStr || payload.from || 'Unknown Node';
            const messageText = payload.payload.text.trim();

            // Prevent recording duplicate reflections of your own web gateway messages
            if (senderName === 'TeleLink-BH') return;

            // Add message to rolling local memory storage array
            chatHistory.push({
                id: messageCounter++,
                sender: senderName,
                text: messageText,
                timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
            });

            // Keep array trimmed down to avoid performance bottlenecks
            if (chatHistory.length > 30) chatHistory.shift();
        }
    } catch (e) {
        // Skip malformed packets or telemetry node updates safely
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

// Endpoint to handle web browser broadcasts
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

    // Use regular text uplink topic protocol to transmit out
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
