/**
 * Cloudflare R2 uploads via S3-compatible API.
 *
 * AWS SDK JS v3.729+ enables default request checksums that R2 may reject.
 * We pin compatible settings AND strip checksum headers as a belt-and-suspenders fix.
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

const getR2ConfigStatus = () => {
    const c = readR2Config();
    return {
        configured: isR2Configured(),
        hasAccountId: Boolean(c.accountId),
        hasAccessKeyId: Boolean(c.accessKeyId),
        hasSecretAccessKey: Boolean(c.secretAccessKey),
        hasBucketName: Boolean(c.bucketName),
        hasPublicUrlPrefix: Boolean(c.publicUrlPrefix),
        bucketName: c.bucketName || null,
        publicUrlPrefix: c.publicUrlPrefix || null,
        endpoint: c.accountId ? `https://${c.accountId}.r2.cloudflarestorage.com` : null,
        accountIdPrefix: c.accountId ? `${c.accountId.slice(0, 6)}…` : null
    };
};

const CHECKSUM_HEADER_RE = /^x-amz-checksum-/i;
const stripChecksumMiddleware = (next) => async (args) => {
    const headers = args?.request?.headers;
    if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
            if (CHECKSUM_HEADER_RE.test(key) || key.toLowerCase() === 'x-amz-sdk-checksum-algorithm') {
                delete headers[key];
            }
        }
    }
    return next(args);
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
        // Disable default flexible checksums (SDK >= 3.729)
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED'
    });

    // Extra safety: remove any checksum headers the SDK still injects
    s3Client.middlewareStack.add(stripChecksumMiddleware, {
        step: 'build',
        name: 'stripR2UnsupportedChecksumHeaders',
        priority: 'high'
    });

    return s3Client;
};

const formatR2Error = (err) => {
    const code = err?.name || err?.Code || err?.code || '';
    const http = err?.$metadata?.httpStatusCode;
    const requestId = err?.$metadata?.requestId;
    const msg = err?.message || String(err);
    const parts = [msg];
    if (code) parts.push(`code=${code}`);
    if (http) parts.push(`http=${http}`);
    if (requestId) parts.push(`requestId=${requestId}`);
    return parts.join(' | ');
};

const uploadFile = async (fileBuffer, fileName, mimeType) => {
    const c = readR2Config();
    if (!c.publicUrlPrefix) {
        throw new Error('R2_PUBLIC_URL_PREFIX is not configured');
    }
    if (!fileBuffer || !fileBuffer.length) {
        throw new Error('Empty file buffer');
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
        const detail = formatR2Error(err);
        console.error('[R2] PutObject failed:', detail, {
            bucket: c.bucketName,
            key,
            bytes: fileBuffer.length,
            mimeType,
            endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`
        });
        throw new Error(`R2 upload failed: ${detail}`);
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
    }
};

module.exports = {
    uploadFile,
    deleteFile,
    isR2Configured,
    getR2ConfigStatus,
    _resetClientForTests: () => {
        s3Client = null;
    }
};
