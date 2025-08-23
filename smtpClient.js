// smtpClient.js
import net from "net";
import tls from "tls";
import { Buffer } from "buffer";

const CRLF = "\r\n";

/**
 * Lê respostas do servidor SMTP (inclui multi-linha: "250-..." até "250 ...").
 */
function createLineReader(socket) {
  let buffer = "";
  const listeners = [];

  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      listeners.forEach((fn) => fn(line));
    }
  };

  socket.on("data", onData); 

  return {
    onLine(fn) {
      listeners.push(fn);
    },
    remove() {
      socket.off("data", onData);
    },
  };
}

/**
 * Aguarda uma resposta SMTP completa (tratando multi-linha).
 * Retorna { code, lines }.
 */

async function readResponse(socket) {
  return new Promise((resolve, reject) => {
    const lines = [];
    let code = null;

    const reader = createLineReader(socket);
    const onLine = (line) => {
      lines.push(line);
      // Formato: 250-continua / 250 fim
      const m = line.match(/^(\d{3})([ -])(.*)$/);
      if (m) {
        const currentCode = parseInt(m[1], 10);
        const sep = m[2];
        code = currentCode;
        if (sep === " ") {
          reader.remove();
          resolve({ code, lines });
        }
      } else {
        // Linha fora do padrão. Alguns servers mandam banners estranhos.
        // Se já temos pelo menos uma com código, ignoramos. Caso contrário, continua.
      }
    };
    reader.onLine(onLine);

    // Timeout de segurança
    socket.setTimeout(20000, () => {
      reader.remove();
      reject(new Error("Timeout aguardando resposta SMTP"));
    });

    socket.once("error", (err) => {
      reader.remove();
      reject(err);
    });
  });
}

function base64(str) {
  return Buffer.from(str, "utf8").toString("base64");
}

function dotStuff(body) {
  // Em bloco DATA, linhas que começam com "." devem virar ".."
  return body.replace(/\r?\n\./g, "\r\n..");
}

function joinHeaders(headersObj) {
  return Object.entries(headersObj)
    .map(([k, v]) => `${k}: ${v}`)
    .join(CRLF);
}

/**
 * Monta MIME:
 * - Se houver anexos: multipart/mixed
 * - Dentro dele, multipart/alternative (text/plain + text/html)
 */
function buildMime({ from, to, cc, bcc, subject, text, html, attachments = [] }) {
  const date = new Date().toUTCString();
  const toList = Array.isArray(to) ? to.join(", ") : to;
  const ccList = cc ? (Array.isArray(cc) ? cc.join(", ") : cc) : undefined;
  const bccList = bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc) : undefined;
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@local>`;

  const headers = {
    "From": from,
    "To": toList,
    ...(ccList ? { "Cc": ccList } : {}),
    ...(bccList ? { "Bcc": bccList } : {}),
    "Subject": subject ?? "",
    "Date": date,
    "Message-ID": messageId,
    "MIME-Version": "1.0"
  };

  const altBoundary = `alt_${Math.random().toString(36).slice(2)}`;
  const mixedBoundary = `mix_${Math.random().toString(36).slice(2)}`;

  const textPart =
    `--${altBoundary}${CRLF}` +
    `Content-Type: text/plain; charset="utf-8"${CRLF}` +
    `Content-Transfer-Encoding: 7bit${CRLF}${CRLF}` +
    `${text || ""}${CRLF}`;

  const htmlPart =
    `--${altBoundary}${CRLF}` +
    `Content-Type: text/html; charset="utf-8"${CRLF}` +
    `Content-Transfer-Encoding: 7bit${CRLF}${CRLF}` +
    `${html || ""}${CRLF}`;

  const altClosing = `--${altBoundary}--${CRLF}`;

  const altBody =
    `Content-Type: multipart/alternative; boundary="${altBoundary}"${CRLF}${CRLF}` +
    textPart + htmlPart + altClosing;

  if (!attachments?.length) {
    // Sem anexos: só multipart/alternative
    return `${joinHeaders(headers)}${CRLF}${altBody}`;
  }

  // Com anexos: multipart/mixed contendo o alt e depois os anexos
  let mixedBody =
    `${joinHeaders(headers)}${CRLF}` +
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"${CRLF}${CRLF}` +
    `--${mixedBoundary}${CRLF}${altBody}`;

  for (const att of attachments) {
    const { filename, contentBase64, contentType = "application/octet-stream" } = att;
    mixedBody +=
      `--${mixedBoundary}${CRLF}` +
      `Content-Type: ${contentType}; name="${filename}"${CRLF}` +
      `Content-Transfer-Encoding: base64${CRLF}` +
      `Content-Disposition: attachment; filename="${filename}"${CRLF}${CRLF}` +
      `${contentBase64}${CRLF}`;
  }
  mixedBody += `--${mixedBoundary}--${CRLF}`;

  return mixedBody;
}

export class SMTPClient {
  constructor({
    host,
    port = 587,
    secure = false, // true = TLS implícito (465)
    user,
    pass,
    helo = "localhost"
  }) {
    this.cfg = { host, port, secure, user, pass, helo };
  }

  async send({ from, to, cc, bcc, subject, text, html, attachments }) {
    const { host, port, secure, user, pass, helo } = this.cfg;
    const rcpts = []
      .concat(to || [])
      .concat(cc || [])
      .concat(bcc || []);
    const recipients = Array.isArray(rcpts) ? rcpts : [rcpts];

    if (!from) throw new Error("Campo 'from' é obrigatório");
    if (!recipients.length) throw new Error("Ao menos um destinatário é obrigatório");

    const socket = secure
      ? tls.connect(port, host, { servername: host })
      : net.connect(port, host);

    // 1) Banner
    let resp = await readResponse(socket);
    if (resp.code !== 220) throw new Error("Falha no banner SMTP: " + resp.lines.join("\n"));

    // 2) EHLO
    socket.write(`EHLO ${helo}${CRLF}`);
    resp = await readResponse(socket);
    if (resp.code !== 250) {
      // tenta HELO simples
      socket.write(`HELO ${helo}${CRLF}`);
      resp = await readResponse(socket);
      if (resp.code !== 250) throw new Error("HELO/EHLO falhou: " + resp.lines.join("\n"));
    }

    // 3) STARTTLS se for porta 587 e não-secure
    const supportsStartTLS = resp.lines.some(l => l.toUpperCase().includes("STARTTLS"));
    if (!secure && supportsStartTLS) {
      socket.write(`STARTTLS${CRLF}`);
      resp = await readResponse(socket);
      if (resp.code !== 220) throw new Error("STARTTLS falhou: " + resp.lines.join("\n"));
      // Upgrade para TLS
      await new Promise((resolve, reject) => {
        socket.removeAllListeners("data"); // evitar leitores antigos
        const secured = tls.connect({ socket, servername: host }, () => resolve());
        // Hack: substitui métodos/props para continuar usando a mesma ref
        socket.write = secured.write.bind(secured);
        socket.on = secured.on.bind(secured);
        socket.once = secured.once.bind(secured);
        socket.setTimeout = secured.setTimeout.bind(secured);
        socket.removeAllListeners = secured.removeAllListeners.bind(secured);
      });
      // EHLO novamente após STARTTLS
      socket.write(`EHLO ${helo}${CRLF}`);
      resp = await readResponse(socket);
      if (resp.code !== 250) throw new Error("EHLO pós-STARTTLS falhou: " + resp.lines.join("\n"));
    }

    // 4) AUTH (se user/pass)
    if (user && pass) {
      const supportsAuthLogin = resp.lines.some(l => /AUTH\b/i.test(l) && /LOGIN/i.test(l));
      const supportsAuthPlain = resp.lines.some(l => /AUTH\b/i.test(l) && /PLAIN/i.test(l));

      if (supportsAuthPlain) {
        // AUTH PLAIN base64(\0user\0pass)
        const payload = base64(`\u0000${user}\u0000${pass}`);
        socket.write(`AUTH PLAIN ${payload}${CRLF}`);
        resp = await readResponse(socket);
        if (resp.code !== 235) throw new Error("AUTH PLAIN falhou: " + resp.lines.join("\n"));
      } else if (supportsAuthLogin) {
        socket.write(`AUTH LOGIN${CRLF}`);
        resp = await readResponse(socket);
        if (resp.code !== 334) throw new Error("AUTH LOGIN não aceito: " + resp.lines.join("\n"));

        socket.write(base64(user) + CRLF);
        resp = await readResponse(socket);
        if (resp.code !== 334) throw new Error("Usuário não aceito: " + resp.lines.join("\n"));

        socket.write(base64(pass) + CRLF);
        resp = await readResponse(socket);
        if (resp.code !== 235) throw new Error("Senha não aceita: " + resp.lines.join("\n"));
      } else {
        throw new Error("Servidor não anuncia AUTH PLAIN/Login");
      }
    }

    // 5) MAIL FROM
    socket.write(`MAIL FROM:<${from}>${CRLF}`);
    resp = await readResponse(socket);
    if (resp.code !== 250) throw new Error("MAIL FROM falhou: " + resp.lines.join("\n"));

    // 6) RCPT TO (para cada destinatário)
    for (const rcpt of recipients) {
      socket.write(`RCPT TO:<${rcpt}>${CRLF}`);
      resp = await readResponse(socket);
      if (resp.code !== 250 && resp.code !== 251) {
        throw new Error(`RCPT TO ${rcpt} falhou: ` + resp.lines.join("\n"));
      }
    }

    // 7) DATA
    socket.write(`DATA${CRLF}`);
    resp = await readResponse(socket);
    if (resp.code !== 354) throw new Error("DATA não aceito: " + resp.lines.join("\n"));

    // 8) Corpo MIME
    const raw = buildMime({ from, to, cc, bcc, subject, text, html, attachments });
    const normalized = raw.replace(/\r?\n/g, CRLF);
    const stuffed = dotStuff(normalized);

    socket.write(stuffed + CRLF + `.${CRLF}`);
    resp = await readResponse(socket);
    if (resp.code !== 250) throw new Error("Envio do corpo falhou: " + resp.lines.join("\n"));

    // 9) QUIT
    socket.write(`QUIT${CRLF}`);
    await readResponse(socket);

    socket.end();
    return { ok: true, message: "Enviado" };
  }
}
