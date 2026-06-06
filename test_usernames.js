const nodemailer = require('nodemailer');

const SMTP_HOST = 'mx6.mailspace.id';
const SMTP_PORT = 465;
const SMTP_SECURE = true;
const SMTP_PASS = 'PapPap321-';
const SMTP_TLS_SERVERNAME = 'mx6.mailspace.id';

const usernames = [
    'norereply-takcakap.com@kotacyber.my',
    'noreply-takcakap.com@kotacyber.my',
    'no-reply@takcakap.com',
    'no-rereply@takcakap.com'
];

async function testUsernames() {
    for (const user of usernames) {
        console.log(`Testing login for: ${user}`);
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: { user, pass: SMTP_PASS },
            tls: { servername: SMTP_TLS_SERVERNAME }
        });

        try {
            await transporter.verify();
            console.log(`🎉 SUCCESS! Login succeeded for: ${user}`);
        } catch (err) {
            console.log(`❌ FAILED for ${user}: ${err.message}`);
        }
    }
}

testUsernames();
