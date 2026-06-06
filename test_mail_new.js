require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    servername: process.env.SMTP_TLS_SERVERNAME,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  logger: true,
  debug: true
});

console.log("Testing with:");
console.log("Host:", process.env.SMTP_HOST);
console.log("Port:", process.env.SMTP_PORT);
console.log("User:", process.env.SMTP_USER);

transporter.verify(function(error, success) {
  if (error) {
    console.log("Verify error:");
    console.error(error);
  } else {
    console.log("Server is ready to take our messages");
    
    // Now try to send a test email
    const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
        to: 'arifsuhaimi1726@gmail.com',
        subject: 'Test Email Config',
        text: 'This is a test email to verify credentials after your recent change.'
    };
    
    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.log("SendMail Error:");
            console.error(err);
        } else {
            console.log("Message sent: %s", info.messageId);
        }
    });
  }
});
