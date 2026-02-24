import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable: ${name}`);
  return value;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  databaseUrl: required('DATABASE_URL'),
  botMode: (process.env.BOT_MODE || 'polling') as 'polling' | 'webhook',
  webhookDomain: process.env.WEBHOOK_DOMAIN || '',
  webhookPath: process.env.WEBHOOK_PATH || '/webhook',
  port: parseInt(process.env.PORT || '3000', 10),
  superAdminTelegramId: process.env.SUPER_ADMIN_TELEGRAM_ID
    ? BigInt(process.env.SUPER_ADMIN_TELEGRAM_ID)
    : undefined,
  TZ_OFFSET: 7,
} as const;
