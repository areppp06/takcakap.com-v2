/**
 * Cloudflare R2 uploads via S3-compatible API.
 * Note: AWS SDK JS v3.729+ defaults integrity checksums that break R2 PutObject
 * unless requestChecksumCalculation / responseChecksumValidation are WHEN_REQUIRED.
 */
'use strict';

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

let s3Client = null;

const readR2Config = () => ({
    accountId: String(process.env.R2_ACCOUNT_ID || '').trim(),
    accessKeyId: String(process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucketName: String(process.env.R2_BUCKET_NAME || '').trim(),
    publicUrlPrefix: String(process.env.R2_PUBLIC_URL_PREFIX || '').trim().replace(/\/+$/, '')
});

const isR2Configured = () => {
    const c = readR2Config();
    return Boolean(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucketName && c.publicUrlPrefix);
};

const getS3Client = () => {
    if (s3Client) return s3Client;

    const c = readR2Config();
    if (!c.accountId || !c.accessKeyId || !c.secretAccessKey || !c.bucketName) {
        throw new Error(
            'Cloudflare R2 is not fully configured (need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)'
        );
    }

    s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: c.accessKeyId,
            secretAccessKey: c.secretAccessKey
        },
        // Required for @aws-sdk/client-s3 >= 3.729 with Cloudflare R2
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED'
    });

    return s3Client;
};

const formatR2Error = (err) => {
    const code = err?.name || err?.Code || err?.code || '';
    const http = err?.$metadata?.httpStatusCode;
    const msg = err?.message || String(err);
    const parts = [msg];
    if (code) parts.push(`code=${code}`);
    if (http) parts.push(`http=${http}`);
    return parts.join(' | ');
};

const uploadFile = async (fileBuffer, fileName, mimeType) => {
    const c = readR2Config();
    if (!c.publicUrlPrefix) {
        throw new Error('R2_PUBLIC_URL_PREFIX is not configured');
    }

    const client = getS3Client();

    const timestamp = Date.now();
    const lastDot = String(fileName || 'file').lastIndexOf('.');
    const ext = lastDot !== -1 ? String(fileName).slice(lastDot + 1) : '';
    const base = lastDot !== -1 ? String(fileName).slice(0, lastDot) : String(fileName || 'file');
    const safeBase = base.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'file';
    const key = `uploads/${timestamp}-${safeBase}${ext ? `.${ext}` : ''}`;

    try {
        await client.send(
            new PutObjectCommand({
                Bucket: c.bucketName,
                Key: key,
                Body: fileBuffer,
                ContentType: mimeType || 'application/octet-stream'
            })
        );
    } catch (err) {
        console.error('[R2] PutObject failed:', formatR2Error(err), {
            bucket: c.bucketName,
            key,
            endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`
        });
        throw new Error(`R2 upload failed: ${formatR2Error(err)}`);
    }

    return `${c.publicUrlPrefix}/${key}`;
};

const deleteFile = async (imageUrl) => {
    if (!isR2Configured() || !imageUrl) return;

    const c = readR2Config();
    if (!c.publicUrlPrefix) return;
    if (!String(imageUrl).startsWith(c.publicUrlPrefix)) return;

    const client = getS3Client();
    const key = String(imageUrl).slice(c.publicUrlPrefix.length).replace(/^\/+/, '');
    if (!key) return;

    try {
        await client.send(
            new DeleteObjectCommand({
                Bucket: c.bucketName,
                Key: key
            })
        );
    } catch (err) {
        console.error('[R2] DeleteObject failed:', formatR2Error(err), { key });
        // Non-fatal for menu updates
    }
};

module.exports = {
    uploadFile,
    deleteFile,
    isR2Configured,
    // for tests / debug
    _resetClientForTests: () => {
        s3Client = null;
    }
};
