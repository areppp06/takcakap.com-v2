const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL_PREFIX = process.env.R2_PUBLIC_URL_PREFIX;

let s3Client = null;

const getS3Client = () => {
  if (s3Client) return s3Client;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error('Cloudflare R2 is not fully configured in environment variables');
  }

  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  return s3Client;
};

const isR2Configured = () => {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
};

const uploadFile = async (fileBuffer, fileName, mimeType) => {
  const client = getS3Client();
  
  const prefix = String(R2_PUBLIC_URL_PREFIX || '').trim().replace(/\/+$/, '');
  if (!prefix) {
    throw new Error('R2_PUBLIC_URL_PREFIX is not configured');
  }

  const timestamp = Date.now();
  // Extract file extension and base name
  const lastDot = fileName.lastIndexOf('.');
  const ext = lastDot !== -1 ? fileName.slice(lastDot + 1) : '';
  const base = lastDot !== -1 ? fileName.slice(0, lastDot) : fileName;
  const safeBase = base.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const key = `uploads/${timestamp}-${safeBase}${ext ? `.${ext}` : ''}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  await client.send(command);

  return `${prefix}/${key}`;
};

const deleteFile = async (imageUrl) => {
  if (!isR2Configured() || !imageUrl) return;

  const prefix = String(R2_PUBLIC_URL_PREFIX || '').trim().replace(/\/+$/, '');
  if (!prefix) return;

  // Check if the image URL starts with our R2 public prefix
  if (!imageUrl.startsWith(prefix)) {
    return; // Not an R2 file or different environment/domain
  }

  const client = getS3Client();
  
  // Extract key: it is the path after the prefix (excluding leading slashes)
  const key = imageUrl.slice(prefix.length).replace(/^\/+/, '');
  if (!key) return;

  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  await client.send(command);
};

module.exports = {
  uploadFile,
  deleteFile,
  isR2Configured,
};
