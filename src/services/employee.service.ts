import { prisma } from '../prisma';
import { generateInvitationCode } from '../utils/invitation';
import { Role } from '../generated/prisma/client';

export const employeeService = {
  async findByTelegramId(telegramId: bigint) {
    return prisma.employee.findUnique({ where: { telegramId } });
  },

  async findByInvitationCode(code: string) {
    return prisma.employee.findUnique({ where: { invitationCode: code } });
  },

  async linkTelegram(employeeId: number, telegramId: bigint, telegramUsername?: string) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: { telegramId, telegramUsername: telegramUsername ?? null, invitationCode: null },
    });
  },

  async create(data: { firstName: string; lastName: string; role?: Role }) {
    const code = generateInvitationCode();
    return prisma.employee.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role ?? Role.EMPLOYEE,
        invitationCode: code,
      },
    });
  },

  async deactivate(employeeId: number) {
    return prisma.employee.update({
      where: { id: employeeId },
      data: { isActive: false },
    });
  },

  async setRate(employeeId: number, rate: number, effectiveFrom: Date) {
    return prisma.employeeRate.create({
      data: { employeeId, rate, effectiveFrom },
    });
  },

  async generateInvitationCode() {
    return generateInvitationCode();
  },
};
