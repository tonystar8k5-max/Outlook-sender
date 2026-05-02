import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";

async function startServer() {
  const app = express();
  
  // Enable CORS for all origins - critical for .exe/Electron apps
  app.use(cors());
  
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  const PORT = 3000;

  function processSpintax(text: string): string {
    return text.replace(/{([^{}]+)}/g, (match, options) => {
      const choices = options.split('|');
      return choices[Math.floor(Math.random() * choices.length)];
    });
  }

  async function refreshAccessToken(refreshToken: string, clientId: string): Promise<string | null> {
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://graph.microsoft.com/.default offline_access'
    });

    try {
      // 1. Try Microsoft Graph v2.0 endpoint (Standard/Enterprise)
      const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams.toString(),
      });
      const data: any = await response.json();
      if (data.access_token) return data.access_token;
      
      // Check for Service Abuse Mode
      if (JSON.stringify(data).includes("abuse") || data.error_description?.includes("abuse")) {
        throw new Error("ACCOUNT_BLOCKED_ABUSE");
      }

      // 2. Try Live.com endpoint (Personal/Outlook.com)
      const responseLive = await fetch('https://login.live.com/oauth20_token.srf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams.toString(),
      });
      const dataLive: any = await responseLive.json();
      if (dataLive.access_token) return dataLive.access_token;

      if (JSON.stringify(dataLive).includes("abuse") || dataLive.error_description?.includes("abuse")) {
        throw new Error("ACCOUNT_BLOCKED_ABUSE");
      }

      console.error("Token refresh failed. Response:", data, dataLive);
      return null;
    } catch (e: any) {
      if (e.message === "ACCOUNT_BLOCKED_ABUSE") throw e;
      console.error("Refresh error:", e);
      return null;
    }
  }

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is online" });
  });

  // API endpoint for verifying an account
  app.post("/api/verify-account", async (req, res) => {
    const { account } = req.body;

    if (!account) return res.status(400).json({ error: "Missing account line" });

    const parts = account.split('|');
    const email = parts[0]?.trim();
    const password = parts[1]?.trim();
    const refreshToken = parts[2]?.trim();
    const clientId = parts[3]?.trim();

    if (!email) return res.status(400).json({ error: "Invalid format: Email required" });

    try {
      let workingToken = null;
      
      // Priority 1: Use Refresh Token + Client ID (Graph API)
      if (refreshToken && clientId) {
        console.log(`Verifying via Refresh Token for ${email}...`);
        try {
          const refreshed = await refreshAccessToken(refreshToken, clientId);
          if (refreshed) {
            workingToken = refreshed;
          }
        } catch (re: any) {
          if (re.message === "ACCOUNT_BLOCKED_ABUSE") {
            return res.json({ success: false, error: "ACCOUNT BLOCKED: Service Abuse Mode detected by Microsoft." });
          }
        }
      }

      if (workingToken) {
        const verifyMethods = [
          { name: "GRAPH_API", url: "https://graph.microsoft.com/v1.0/me", headers: { "Authorization": `Bearer ${workingToken}` } },
          { name: "OUTLOOK_REST", url: "https://outlook.office.com/api/v2.0/me", headers: { "Authorization": `Bearer ${workingToken}` } }
        ];

        for (const method of verifyMethods) {
          try {
            const apiRes = await fetch(method.url, { headers: method.headers });
            if (apiRes.ok) return res.json({ success: true, method: method.name, refreshed: !!workingToken });
          } catch (e) {}
        }
      }

      // Priority 2: Standard SMTP (if password is provided and above fails)
      if (password && password !== "-" && password.length >= 5) {
        try {
          const transporter = nodemailer.createTransport({
            host: 'smtp.office365.com',
            port: 587,
            secure: false,
            auth: { user: email, pass: password },
            tls: { ciphers: 'SSLv3', rejectUnauthorized: false }
          });
          await transporter.verify();
          return res.json({ success: true, method: "SMTP" });
        } catch (smtpErr: any) {
          if (smtpErr.message.includes("SmtpClientAuthentication is disabled")) {
             // If SMTP is disabled but we have a token, we should have caught it above.
             // If we didn't, the token itself might be invalid.
          }
           throw smtpErr;
        }
      }

      res.json({ success: false, error: "Auth payload failed. Ensure your Refresh Token and Client ID are correct." });
    } catch (error: any) {
      let errorMessage = error.message || "Verification failed";
      if (errorMessage.includes("SmtpClientAuthentication is disabled")) {
        errorMessage = "SMTP AUTH DISABLED";
      }
      res.json({ success: false, error: errorMessage });
    }
  });

  // API endpoint for sending a single email
  app.post("/api/send-one", async (req, res) => {
    const { account, recipient, subject, body } = req.body;

    if (!account || !recipient || !subject || !body) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { attachments, attachBodyAsDoc } = req.body;
    
    const processedSubject = processSpintax(subject);
    const processedBody = processSpintax(body);

    // Account format: email|password|token|id
    const parts = account.split('|');
    const email = parts[0];
    const password = parts[1];
    const puid = parts[3];
    const rawToken = parts[2] || "";
    let token = rawToken.trim();

    if (!email) {
      return res.status(400).json({ error: "Invalid account format" });
    }

    const mailAttachments: any[] = [];
    // Helper to generate attachments (useful for both SMTP and API)
    if (attachBodyAsDoc) {
      const doc = new PDFDocument();
      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      const cleanBody = processedBody.replace(/<[^>]*>?/gm, '');
      doc.fontSize(12).text(cleanBody);
      doc.end();
      const pdfBuffer = await new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
      });
      mailAttachments.push({
        filename: 'document_scan.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf'
      });
    }
    if (attachments && Array.isArray(attachments)) {
      attachments.forEach((att: any, index: number) => {
        let base64Part = att.content;
        if (base64Part.includes('base64,')) {
          base64Part = base64Part.split('base64,')[1];
        }
        
        mailAttachments.push({
          filename: att.filename,
          content: base64Part,
          encoding: 'base64',
          contentType: att.contentType || 'application/octet-stream',
          cid: att.isInline ? (att.cid || `img_${index}`) : undefined,
          contentDisposition: att.isInline ? 'inline' : 'attachment'
        });
      });
    }

    const mailOptions: any = {
      from: `"${email}" <${email}>`,
      to: recipient,
      subject: processedSubject,
      text: processedBody.replace(/<[^>]*>?/gm, ''),
      html: processedBody,
      attachments: mailAttachments
    };

    // Prepare API attachments
    const getBase64 = (content: any) => {
      if (Buffer.isBuffer(content)) return content.toString('base64');
      if (typeof content === 'string') return content;
      return '';
    };

    const graphAttachments = mailAttachments.map(att => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.filename,
      contentType: att.contentType,
      contentBytes: getBase64(att.content),
      isInline: att.isInline || false,
      contentId: att.cid || undefined
    }));

    const outlookAttachments = mailAttachments.map(att => ({
      "@odata.type": "#Microsoft.OutlookServices.FileAttachment",
      Name: att.filename,
      ContentType: att.contentType,
      ContentBytes: getBase64(att.content),
      IsInline: att.isInline || false,
      ContentId: att.cid || undefined
    }));

    try {
      let workingToken = null;
      const parts = account.split('|');
      const email = parts[0]?.trim();
      const password = parts[1]?.trim();
      const refreshToken = parts[2]?.trim();
      const clientId = parts[3]?.trim();

      if (!email) throw new Error("Invalid account format: Email is missing");

      // Priority 1: Use Refresh Token + Client ID (Graph API)
      if (refreshToken && clientId) {
        try {
          const refreshed = await refreshAccessToken(refreshToken, clientId);
          if (refreshed) {
            workingToken = refreshed;
          }
        } catch (re: any) {
          if (re.message === "ACCOUNT_BLOCKED_ABUSE") {
            throw new Error("ACCOUNT_BLOCKED_ABUSE");
          }
        }
      }

      if (workingToken) {
        // Send via Graph API
        const graphUrl = "https://graph.microsoft.com/v1.0/me/sendMail";
        const graphBody = {
          message: {
            subject: processedSubject,
            body: { contentType: "HTML", content: processedBody },
            toRecipients: [{ emailAddress: { address: recipient } }],
            attachments: graphAttachments
          }
        };

        const apiRes = await fetch(graphUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${workingToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(graphBody)
        });

        if (apiRes.ok || apiRes.status === 202) {
          return res.json({ success: true, method: "GRAPH_API" });
        } else {
          const errTxt = await apiRes.text();
          console.error(`Graph API failed for ${email}:`, errTxt);
          // Fallback to Outlook REST if Graph fails
          const outlookUrl = "https://outlook.office.com/api/v2.0/me/sendmail";
          const outlookRes = await fetch(outlookUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${workingToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              Message: {
                Subject: processedSubject,
                Body: { ContentType: "HTML", Content: processedBody },
                ToRecipients: [{ EmailAddress: { Address: recipient } }],
                Attachments: outlookAttachments
              }
            })
          });
          if (outlookRes.ok || outlookRes.status === 202) {
             return res.json({ success: true, method: "OUTLOOK_REST" });
          }
        }
      }

      // Priority 2: Standard SMTP
      if (password && password !== "-" && password.length >= 5) {
        const transporter = nodemailer.createTransport({
          host: 'smtp.office365.com',
          port: 587,
          secure: false,
          auth: { user: email, pass: password },
          tls: { ciphers: 'SSLv3', rejectUnauthorized: false }
        });
        const info = await transporter.sendMail(mailOptions);
        return res.json({ success: true, method: "SMTP", messageId: info.messageId });
      }

      throw new Error("No valid sending method available. Check your token/password.");

    } catch (error: any) {
      console.error(`Error sending from ${email}:`, error);
      
      let errorMessage = error.message || "Failed to send email";
      if (errorMessage === "ACCOUNT_BLOCKED_ABUSE") {
        errorMessage = "ACCOUNT BLOCKED: Service Abuse Mode. This mailbox has been suspended by Microsoft.";
      } else if (errorMessage.includes("SmtpClientAuthentication is disabled") || errorMessage.includes("535 5.7.139")) {
        errorMessage = "SMTP AUTH DISABLED: Please enable 'Authenticated SMTP' in your Microsoft/Outlook settings for this mailbox. Visit https://aka.ms/smtp_auth_disabled for instructions.";
      }

      res.status(500).json({ 
        success: false, 
        error: errorMessage,
        account: email
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production: server.cjs is INSIDE the dist folder, so distPath is __dirname
    const distPath = __dirname;
    console.log('Production mode: Serving static files from', distPath);
    
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Frontend build (index.html) index not found next to server.cjs.');
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
