const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const cors = require("cors");
const os = require("os");
const axios = require("axios");
const rimraf = require('rimraf');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());

const SESSIONS_DIR = path.join(__dirname, "sessions");
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);

const clients = {};

fs.readdirSync(SESSIONS_DIR).forEach((file) => {
    const userId = file;
    console.log(`🔄 Recuperando sessão de ${userId}...`);
    startSession(userId);
});

io.on("connection", (socket) => {
    console.log("Cliente conectado:", socket.id);

    socket.on("create-session", (userId) => {
        if (clients[userId]) {
            console.log(`✅ Sessão ativa para: ${userId}`);
            io.to(socket.id).emit("ready", { userId });
            return;
        }
        console.log(`🔑 Criando nova sessão para: ${userId}`);
        startSession(userId, socket);
    });

    socket.on("disconnect", () => console.log("Cliente desconectado:", socket.id));
});
function removeSessionDirectory(userId) {
    const sessionDir = path.join(SESSIONS_DIR, userId);
    rimraf(sessionDir, (err) => {
        if (err) {
            console.error("Erro ao excluir diretório de sessão:", err);
        } else {
            console.log(`Sessão de ${userId} removida com sucesso.`);
        }
    });
}
function startSession(userId, socket = null) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId, dataPath: path.join(SESSIONS_DIR, userId) }),
    });
    clients[userId] = client;

    client.on("qr", (qr) => {
        QRCode.toDataURL(qr, (err, url) => {
            if (!err && socket) io.to(socket.id).emit("qr", { userId, qr: url });
        });
    });

    client.on("ready", () => {
        console.log(`✅ WhatsApp de ${userId} conectado.`);
        if (socket) io.to(socket.id).emit("ready", { userId });
    });

    client.on("disconnected", () => {
        console.log(`❌ Sessão de ${userId} desconectada`);
        delete clients[userId];
        fs.rmSync(path.join(SESSIONS_DIR, userId), { recursive: true, force: true });
    });

    client.initialize();
}

app.get("/chats/:userId", async (req, res) => {
    const client = clients[req.params.userId];
    if (!client) return res.status(400).json({ error: "Sessão não encontrada" });

    // Verificar se a sessão está pronta
    if (!client.isReady) {
        return res.status(400).json({ error: "Sessão não está pronta" });
    }

    try {
        const chats = await client.getChats();
        res.json(chats.map(chat => ({ id: chat.id._serialized, name: chat.name || chat.id.user })));
    } catch (error) {
        console.error(`Erro ao carregar chats para ${req.params.userId}:`, error);
        removeSessionDirectory(req.params.userId);

        const socket = io.sockets.sockets.get(req.socket);
        if (socket) {
            console.log(`🔄 Reiniciando sessão para ${req.params.userId}...`);
            startSession(req.params.userId, socket);
        }

        res.status(500).json({ error: "Erro ao carregar chats. Sessão reiniciada, escaneie o QR Code novamente." });
    }
});


app.get("/messages/:userId/:chatId", async (req, res) => {
    const client = clients[req.params.userId];
    if (!client) return res.status(400).json({ error: "Sessão não encontrada" });
    try {
        const chat = await client.getChatById(req.params.chatId);
        const messages = await chat.fetchMessages({ limit: 20 });
        res.json(messages.map(msg => ({ fromMe: msg.fromMe, body: msg.body, timestamp: msg.timestamp })));
    } catch (error) {
        res.status(500).json({ error: "Erro ao carregar mensagens" });
    }
});

app.post("/send-message", async (req, res) => {
    const { userId, phone, message } = req.body;
    const client = clients[userId];
    if (!client){
        console.log("error Sessão não encontrada" )
        return res.status(400).json({ error: "Sessão não encontrada" });
    } 
    try {
        await client.sendMessage(phone, message);
        res.json({ success: true, message: "Mensagem enviada com sucesso!" });
    } catch (error) {
        res.status(500).json({ error: "Erro ao enviar mensagem" });
        console.log(error)
    }
});

server.listen(3001, "0.0.0.0", () => {
    const interfaces = os.networkInterfaces();
    let localIP = Object.values(interfaces).flat().find(config => config.family === "IPv4" && !config.internal)?.address || "Não encontrado";
    console.log(`🚀 Servidor rodando em: \n➡️ Local: http://localhost:3001 \n🌐 Na rede: http://${localIP}:3001`);
    axios.get("https://ifconfig.me").then(response => console.log(`🌍 IP público: http://${response.data}:3001`)).catch(() => console.error("Erro ao obter IP público"));
});