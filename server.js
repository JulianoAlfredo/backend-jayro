
const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const http = require("http");
const https = require("https");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const cors = require("cors");
const os = require("os");
const axios = require("axios");
const rimraf = require('rimraf');
const agent = new https.Agent({
    rejectUnauthorized: false, // ignora o erro de certificado inválido
  });

const ASAAS_API_KEY = "$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmFmOWUzMjU1LTA4ZTEtNGNhOS04Zjg0LTk5OTAxYWM4NjEzMTo6JGFhY2hfN2RlMTk4MTAtNzY2Yy00ZTQ0LThmY2YtMWFiY2FjOWI1MmJj"; // Substitua pela sua chave da API ASAAS
const ASAAS_BASE_URL = "https://www.asaas.com/api/v3";



const options = {
    key: fs.readFileSync("/etc/letsencrypt/live/jayrobackend.com.br/privkey.pem"),
    cert: fs.readFileSync("/etc/letsencrypt/live/jayrobackend.com.br/fullchain.pem")
};

const app = express();
const server = https.createServer(options, app); // Alterado para HTTPS
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

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


app.post("/logout", async (req, res) => {
    const { userId } = req.body;
    const client = clients[userId];
    if (!client) {
        console.log("Sem client");
        return res.status(400).json({ error: "Sessão não encontrada" });
    
	}

    try {
        const sessionPath = path.join(SESSIONS_DIR, userId);
       
        await fs.rm(sessionPath, { recursive: true, force: true },(err) =>{
            console.error(err)
        });
        console.log("Session deleted!");
        res.json({ success: true, message: "Sessão encerrada com sucesso" });
    } catch (error) {
        console.error(`Erro ao encerrar sessão de ${userId}:`, error);
        res.status(500).json({ error: "Erro ao encerrar sessão" });
    }
});




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
        console.log("Ok")
        res.json({ success: true, message: "Mensagem enviada com sucesso!" });
    } catch (error) {
        console.log("ERRO")
        res.status(500).json({ error: "Erro ao enviar mensagem" });
        console.log(error)
    }
});

app.post("/asaas/assinatura", async (req, res) => {
    const { nome, cpfCnpj, email, telefone, assinatura } = req.body;
    // assinatura: { billingType, value, nextDueDate, cycle, description, ... }

    try {
        // 1. Buscar cliente pelo CPF/CNPJ
        let clienteId = null;
        const clientesResp = await axios.get(
            `${ASAAS_BASE_URL}/customers?cpfCnpj=${cpfCnpj}`,
            { headers: { access_token: ASAAS_API_KEY } }
        );
        if (clientesResp.data.totalCount > 0) {
            clienteId = clientesResp.data.data[0].id;
        } else {
            // 2. Criar cliente se não existir
            const clienteResp = await axios.post(
                `${ASAAS_BASE_URL}/customers`,
                { name: nome, cpfCnpj, email, phone: telefone },
                { headers: { access_token: ASAAS_API_KEY } }
            );
            clienteId = clienteResp.data.id;
        }

        // 3. Verificar se já existe assinatura ativa
        const assinaturasResp = await axios.get(
            `${ASAAS_BASE_URL}/subscriptions?customer=${clienteId}`,
            { headers: { access_token: ASAAS_API_KEY } }
        );
        const assinaturaAtiva = (assinaturasResp.data.data || []).find(sub =>
            ["ACTIVE", "PENDING", "UNPAID", "RECEIVED", "PAID", "RECEIVED_IN_CASH"].includes(sub.status)
        );

        if (assinaturaAtiva) {
            // Buscar cobrança vinculada à assinatura
            const faturasResp = await axios.get(
                `${ASAAS_BASE_URL}/payments?subscription=${assinaturaAtiva.id}`,
                { headers: { access_token: ASAAS_API_KEY } }
            );
            const fatura = faturasResp.data.data[0];
            console.log(fatura)
            if(fatura?.status == "RECEIVED" || fatura?.status == "RECEIVED_IN_CASH" ){
                return res.json({
                    message: "ASSINATURA PAGA",
                })
            } else{
                return res.json({
                    message: "Já existe uma assinatura ativa",
                    assinaturaId: assinaturaAtiva.id,
                    invoiceUrl: fatura?.invoiceUrl || null,
                    status: fatura?.status || assinaturaAtiva.status
                });
            }

        }

        // 4. Criar assinatura
        assinatura.customer = clienteId;
        const novaAssinaturaResp = await axios.post(
            `${ASAAS_BASE_URL}/subscriptions`,
            assinatura,
            { headers: { access_token: ASAAS_API_KEY } }
        );
        const novaAssinatura = novaAssinaturaResp.data;

        // Buscar cobranças associadas à assinatura para pegar o link
        let invoiceUrl = null, status = null;
        if (novaAssinatura.id) {
            const faturasResp = await axios.get(
                `${ASAAS_BASE_URL}/payments?subscription=${novaAssinatura.id}`,
                { headers: { access_token: ASAAS_API_KEY } }
            );
            const fatura = faturasResp.data.data[0];
            invoiceUrl = fatura?.invoiceUrl || null;
            status = fatura?.status || null;
        }

        res.json({
            ...novaAssinatura,
            invoiceUrl,
            status
        });

    } catch (error) {
        console.error("Erro ASAAS assinatura:", error.response?.data || error.message);
        res.status(500).json({ error: "Erro ao processar assinatura ASAAS", detalhes: error.response?.data });
    }
});



app.get("/*", async (req,res) =>{
	console.log(req.params);
})

server.listen(3001, "0.0.0.0", () => {
    const interfaces = os.networkInterfaces();
    let localIP = Object.values(interfaces).flat().find(config => config.family === "IPv4" && !config.internal)?.address || "Não encontrado";
    console.log(`🚀 Servidor HTTPS rodando em: \n➡️ Local: https://localhost:3001 \n🌐 Na rede: https://${localIP}:3001`);
    axios.get("https://ifconfig.me")
        .then(response => console.log(`🌍 IP público: https://${response.data}:3001`))
        .catch(() => console.error("Erro ao obter IP público"));
});
