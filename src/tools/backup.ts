import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { format } from "date-fns";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function runBackup() {
  const timestamp = format(new Date(), "yyyy-MM-dd-HH-mm-ss-SSS");
  const fileName = `backup-${timestamp}.tar.gz`;
  const backupPath = path.join("/tmp", fileName);
  const sourceDir = path.join(process.env.HOME!, ".pi/agent");
  console.log("Checking credentials...");
  console.log("Endpoint:", process.env.R2_ENDPOINT);
  console.log(
    "Access Key ID:",
    process.env.R2_ACCESS_KEY_ID ? "✅ Loaded" : "❌ MISSING",
  );
  console.log(
    "Secret Key:",
    process.env.R2_SECRET_ACCESS_KEY ? "✅ Loaded" : "❌ MISSING",
  );

  try {
    // Упаковка данных (исключая node_modules)
    execSync(
      `tar --exclude='node_modules' -czf ${backupPath} -C ${sourceDir} .`,
    );

    const fileBuffer = fs.readFileSync(backupPath);

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BACKUP_BUCKET_NAME,
        Key: `daily/${fileName}`,
        Body: fileBuffer,
        ContentType: "application/gzip",
      }),
    );

    console.log(`[Backup] Успешно загружен: ${fileName}`);
    fs.unlinkSync(backupPath); // Удаляем временный файл
  } catch (error) {
    console.error("[Backup] Ошибка:", error);
  }
}
