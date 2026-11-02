const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const { MeshDevice } = require('@meshtastic/js');
const app = express();

app.use(express.json());

// Enable CORS for your exact Neocities subdomain layout
app.use(cors({
    origin: 'https://neocities.org'
}));

// Global variable arrays to store decoded text history
let chatHistory = [
    { id: 1, sender: 'TeleLink', text: 'Gateway online. Listening for decoded binary packets...' }
];
let messageCounter = 2;
let lastBroadcastTime = 0;
const COOLDOWN_MS = 3 * 60 * 1000; // 3-minute transmission safety lock

// Connect to the Dutch Meshtastic MQTT Broker
const client = mqtt.connect('mqtt://mqtt.meshnet.nl');

client.on('connect', () => {
    console.log('Connected to mqtt.meshnet.nl');
    // Subscribe to the raw, binary, encrypted countrywide LongFast channel text stream
    client.subscribe('msh/NL/2/c/LongFast', (err) => {
        if (!err) console.log('Subscribed to raw countrywide binary radio feed');
    });
});

// Intercept the raw radio waves and decode them in real-time
client.on('message', (topic, message) => {
    try {
        const decodedPacket = MeshDevice.protobuf.MeshPacket.decode(message);
        
        // Check for TEXT_MESSAGE_APP (portnum 1)
        if (decodedPacket.decoded && decodedPacket.decoded.portnum === 1) {
            const textBytes = decodedPacket.decoded.payload;
            const messageText = Buffer.from(textBytes).toString('utf8').trim();
            const senderId = decodedPacket.fromStr || `Node-${decodedPacket.from.toString(16)}`;

            if (senderId === 'TeleLink-BH') return;

            chatHistory.push({
                id: messageCounter++,
                sender: senderId,
                text: messageText,
                timestamp: new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
            });

            if (chatHistory.length > 30) chatHistory.shift();
        }
    } catch (e) {
        // Skip telemetry or status updates quietly
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

// Endpoint to handle web browser broadcasts (Now properly encoding to binary Protobuf!)
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

    try {
        // 1. Convert the plain text string into a binary payload buffer
        const textPayloadBytes = Buffer.from(userMessage, 'utf8');

        // 2. Wrap it inside the official Meshtastic Data sub-packet payload schema
        const dataPayload = MeshDevice.protobuf.Data.create({
            portnum: 1, // 1 = TEXT_MESSAGE_APP protocol descriptor
            payload: textPayloadBytes
        });

        // 3. Assemble the final complete network MeshPacket wrapper envelope structure
        const meshPacket = MeshDevice.protobuf.MeshPacket.create({
            from: 0x12345678, // Dummy web generator ID hex integer
            to: 0xffffffff,   // Broadcast address target packet locator (all nodes)
            decoded: dataPayload,
            id: Math.floor(Math.random() * 0xffffffff),
            wantAck: false,
            hopLimit: 3,
            fromStr: "TeleLink-BH" // The display callsign label tagging your site
        });

        // 4. Serialize into a raw system binary buffer line
        const binaryBufferMessage = MeshDevice.protobuf.MeshPacket.encode(meshPacket).finish();

        // 5. Fire the binary packet onto the live country text stream channel topic
        const topic = "msh/NL/2/c/LongFast"; 
        client.publish(topic, binaryBufferMessage, (err) => {
            if (!err) {
                res.json({ success: true, message: "Broadcasted successfully!" });
            } else {
                lastBroadcastTime = 0;
                res.status(500).json({ error: "Failed to forward packet to the mesh broker." });
            }
        });
    } catch (encodeError) {
        lastBroadcastTime = 0;
        res.status(500).json({ error: "Encoding engine failure trying to compile Protobuf packet structure." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Interactive Gateway running on port ${PORT}`));
