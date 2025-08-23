import express from "express";
import { SMTPClient } from "./smtpClient.js"; // Seu arquivo

const app = express();
app.use(express.json());

app.post("/send-email", async (req, res) => {
  const { host, port, secure, user, pass, helo, from, to, cc, bcc, subject, text, html, attachments } = req.body;

  if (!host || !from || !to) {
    return res.status(400).json({ error: "host, from e to são obrigatórios" });
  }

  try {
    const client = new SMTPClient({ host, port, secure, user, pass, helo });

    const result = await client.send({
      from,
      to,
      cc,
      bcc,
      subject,
      text,
      html,
      attachments,
    });

    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
