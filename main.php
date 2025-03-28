<?php

// Configuração de banco de dados MySQL
$host = '127.0.0.1';  // Seu host MySQL
$dbname = 'u365543324_jayro_entrada';  // Seu banco de dados
$username = 'root';  // Seu usuário MySQL
$password = '';  // Sua senha MySQL

// Conexão com o banco de dados
try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    echo "Erro ao conectar ao banco de dados: " . $e->getMessage();
    exit;
}

// Função para enviar mensagem via WhatsApp
function enviarMensagemWhatsApp($idUsuario, $telefone, $mensagem) {
    $url = "http://localhost:3001/send-message";  // Endpoint do backend Node.js

    $data = [
        "userId" => $idUsuario,
        "phone" => "55".$telefone . "@c.us",
        "message" => $mensagem
    ];

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Content-Type: application/json"
    ]);

    $response = curl_exec($ch);
    curl_close($ch);

    if ($response) {
        $decodedResponse = json_decode($response, true);
        if (isset($decodedResponse['success']) && $decodedResponse['success']) {
            echo "✅ Mensagem enviada para $telefone\n";
        } else {
            echo "❌ Erro ao enviar mensagem para $telefone: " . ($decodedResponse['message'] ?? 'Erro desconhecido') . "\n";
        }
    } else {
        echo "❌ Falha na comunicação com o servidor de mensagens.\n";
    }
    sleep(5);
}

// Consulta para buscar os empréstimos vencidos
$sql = "SELECT id, nome, telefone, valor, dataPagamento, idUsuario FROM emprestimos WHERE dataPagamento < CURDATE() AND status = 'pendente'";
$stmt = $pdo->query($sql);

// Verifica se há resultados
if ($stmt->rowCount() > 0) {
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $id_cliente = $row['id'];
        $nome_cliente = $row['nome'];
        $telefone = $row['telefone'];
        $valor = $row['valor'];
        $data_vencimento = $row['dataPagamento'];
        $idUsuario = $row['idUsuario'];

        // Cria a mensagem para cobrança
        $mensagem = "Olá $nome_cliente,\n\nSeu empréstimo de R$ $valor venceu em $data_vencimento. Pedimos que regularize o pagamento o mais breve possível.\n\nCaso já tenha efetuado o pagamento, desconsidere esta mensagem. \n\n **Chave PIX para Pagamento ABAIXO** \n";
        $chavePix = "b068488e-56e7-45aa-9241-094003ca6522";
        // Envia a mensagem via WhatsApp
        enviarMensagemWhatsApp($idUsuario,$telefone, $mensagem);
        enviarMensagemWhatsApp($idUsuario,$telefone, $chavePix);
    }
} else {
    echo "Nenhum empréstimo vencido encontrado.\n";
}
?>
