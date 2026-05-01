import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const bucket = process.env.S3_CONFIG_BUCKET;
const s3 = bucket ? new S3Client({}) : null;

/**
 * Push a config file to S3 after every local write.
 * No-op when S3_CONFIG_BUCKET is not set (local development).
 * Key mirrors the ~/.dovepaw/ structure, e.g. "settings.json" or "settings.agents/foo/agent.json".
 */
export async function pushConfig(key: string, body: string): Promise<void> {
  if (!s3 || !bucket) return;
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/json" }),
  );
}
