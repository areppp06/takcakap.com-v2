const nodemailer = require('nodemailer');

const SMTP_HOST = 'mx6.mailspace.id';
const SMTP_PORT = 465;
const SMTP_SECURE = true;
const SMTP_TLS_SERVERNAME = 'mx6.mailspace.id';

const combinations = [
    { user: 'norereply-takcakap.com@kotacyber.my', pass: '161288@KC' },
    { user: 'noreply-takcakap.com@kotacyber.my', pass: '161288@KC' },
    { user: 'support@kotacyber.my', pass: '161288@KC' },
    { user: 'norereply-takcakap.com@kotacyber.my', pass: 'PapPap321-' }
];

async function testCombinations() {
    for (const combo of combinations) {
        console.log(`Testing login for: ${combo.user} with pass ${combo.pass}`);
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: { user: combo.user, pass: combo.pass },
            tls: { servername: SMTP_TLS_SERVERNAME }
        });

        try {
            await transporter.verify();
            console.log(`🎉 SUCCESS! Login succeeded for: ${combo.user}`);
            return;
        } catch (err) {
            console.log(`❌ FAILED for ${combo.user}: ${err.message}`);
        }
    }
}

testCombinations();
