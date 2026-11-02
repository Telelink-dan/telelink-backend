const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const app = express();

app.use(express.json());

// 1. Enable CORS for your specific Neocities frontend URL
app.use(cors({
    origin: 'https://neocities.org'
}));

// 2. Connect to the Dutch Meshtastic MQTT Broker
const client = mqtt.connect('mqtt://mqtt.meshnet.nl');

// 3. Global Cooldown to protect the LoRa airwaves
let lastBroadcastTime = 0;
const COOLDOWN_MS = 3 * 60 * 1000; // 3-minute global cooldown

client.on('connect', () => {
    console.log('Connected to mqtt.meshnet.nl broker successfully.');
});

// 4. API Endpoint your Neocities form hits
app.post('/api/broadcast', (req, res) => {
    const now = Date.now();
    
    // Check if the 3-minute safety limit is active
    if (now - lastBroadcastTime < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - (now - lastBroadcastTime)) / 1000);
        return res.status(429).json({ error: `The airwaves are busy. Cooldown active: please wait ${waitSec} seconds.` });
    }

    const userMessage = req.body.message ? req.body.message.trim() : "";

    // Basic layout checks
    if (!userMessage || userMessage.length > 130) {
        return res.status(400).json({ error: 'Message must be between 1 and 130 characters.' });
    }

    // Set the transmission log timestamp
    lastBroadcastTime = now;

    // 5. Structure payload for the LongFast channel uplink
    const topic = "msh/NL/LongFast/uplink"; 
    const payload = {
        text: userMessage,
        fromStr: "TeleLink-BH", // Appears on nodes to credit your Bosschenhoofd setup
    };

    // 6. Broadcast onto the mesh network
    client.publish(topic, JSON.stringify(payload), (err) => {
        if (!err) {
            res.json({ success: true, message: "Broadcasted successfully!" });
        } else {
            lastBroadcastTime = 0; // Reset on failure
            res.status(500).json({ error: "Failed to forward packet to the mesh network broker." });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TeleLink Gateway listening on port ${PORT}`));
