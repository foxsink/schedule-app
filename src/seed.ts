import { prisma } from './prisma';
import { config } from './config';
import { Role } from '@prisma/client';

export async function seedSuperAdmin(): Promise<void> {
  const { superAdminTelegramId } = config;
  if (!superAdminTelegramId) return;

  const existing = await prisma.employee.findUnique({
    where: { telegramId: superAdminTelegramId },
  });

  if (!existing) {
    await prisma.employee.create({
      data: {
        telegramId: superAdminTelegramId,
        firstName: config.superAdminFirstName,
        lastName: config.superAdminLastName,
        role: Role.SUPER_ADMIN,
        invitationCode: null,
      },
    });
    console.log('Super admin created');
  }
}
