import { prisma } from '../prisma';
import { AuditAction, AuditEntityType } from '@prisma/client';

export const auditService = {
  async log(
    editorId: number,
    action: AuditAction,
    entityType: AuditEntityType,
    entityId: number,
    previousData?: object | null,
    newData?: object | null
  ): Promise<void> {
    await prisma.auditLog.create({
      data: {
        editorId,
        action,
        entityType,
        entityId,
        previousData: previousData ?? undefined,
        newData: newData ?? undefined,
      },
    });
  },
};
