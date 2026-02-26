import { TimeEntryType, AdminNotificationSettings, Notification, Employee } from '../generated/prisma/client';
import { prisma } from '../prisma';
import { formatTime, toUTC7 } from '../utils/time';

const TYPE_TO_PUSH_FIELD: Record<TimeEntryType, keyof AdminNotificationSettings> = {
  WORK_START:           'notifyWorkStart',
  WORK_END:             'notifyWorkEnd',
  LUNCH_START:          'notifyLunchStart',
  LUNCH_END:            'notifyLunchEnd',
  PERSONAL_LEAVE_START: 'notifyPersonalLeaveStart',
  PERSONAL_LEAVE_END:   'notifyPersonalLeaveEnd',
  SICK_LEAVE:           'notifySickLeave',
};

const TYPE_TO_LABEL: Record<TimeEntryType, string> = {
  WORK_START:           '🟢 Рабочий день начат',
  WORK_END:             '🔴 Рабочий день завершён',
  LUNCH_START:          '🍽 Ушёл на обед',
  LUNCH_END:            '✅ Вернулся с обеда',
  PERSONAL_LEAVE_START: '🚶 Отлучился',
  PERSONAL_LEAVE_END:   '🔙 Вернулся',
  SICK_LEAVE:           '🤒 Больничный отмечен',
};

const RU_DAYS   = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const PAGE_SIZE = 10;

export const notificationService = {

  async createNotification(employeeId: number, type: TimeEntryType, timestamp: Date): Promise<Notification> {
    return prisma.notification.create({
      data: { employeeId, type, timestamp },
    });
  },

  async getAdminsToPush(employeeId: number, type: TimeEntryType): Promise<Employee[]> {
    const pushField = TYPE_TO_PUSH_FIELD[type];

    const settingsList = await prisma.adminNotificationSettings.findMany({
      where: {
        pushEnabled: true,
        [pushField]: true,
        admin: {
          isActive: true,
          role: { in: ['ADMIN', 'SUPER_ADMIN'] },
          telegramId: { not: null },
          id: { not: employeeId },
        },
      },
      include: {
        admin: true,
        employeeFilters: true,
      },
    });

    const eligible: Employee[] = [];
    for (const s of settingsList) {
      if (s.employeeFilters.length === 0 || s.employeeFilters.some(f => f.employeeId === employeeId)) {
        eligible.push(s.admin);
      }
    }
    return eligible;
  },

  formatPushMessage(employee: Employee, type: TimeEntryType, timestamp: Date): string {
    const label = TYPE_TO_LABEL[type];
    const timeStr = formatTime(timestamp);
    const d = toUTC7(timestamp);
    const dayName = RU_DAYS[d.getUTCDay()];
    const monthName = RU_MONTHS[d.getUTCMonth()];
    const day = d.getUTCDate();
    return `👤 ${employee.lastName} ${employee.firstName}\n${label} в ${timeStr}\n📅 ${dayName}, ${day} ${monthName}`;
  },

  async getOrCreateSettings(adminId: number) {
    let settings = await prisma.adminNotificationSettings.findUnique({
      where: { adminId },
      include: { employeeFilters: true },
    });
    if (!settings) {
      settings = await prisma.adminNotificationSettings.create({
        data: { adminId },
        include: { employeeFilters: true },
      });
    }
    return settings;
  },

  async setPushEnabled(adminId: number, enabled: boolean): Promise<void> {
    await prisma.adminNotificationSettings.upsert({
      where: { adminId },
      update: { pushEnabled: enabled },
      create: { adminId, pushEnabled: enabled },
    });
  },

  async toggleEventType(adminId: number, type: TimeEntryType, enabled: boolean): Promise<void> {
    const field = TYPE_TO_PUSH_FIELD[type] as string;
    await prisma.adminNotificationSettings.upsert({
      where: { adminId },
      update: { [field]: enabled },
      create: { adminId, [field]: enabled },
    });
  },

  async addEmployeeFilter(adminId: number, employeeId: number): Promise<void> {
    const settings = await notificationService.getOrCreateSettings(adminId);
    await prisma.adminNotificationFilter.upsert({
      where: { settingsId_employeeId: { settingsId: settings.id, employeeId } },
      update: {},
      create: { settingsId: settings.id, employeeId },
    });
  },

  async removeEmployeeFilter(adminId: number, employeeId: number): Promise<void> {
    const settings = await prisma.adminNotificationSettings.findUnique({ where: { adminId } });
    if (!settings) return;
    await prisma.adminNotificationFilter.deleteMany({
      where: { settingsId: settings.id, employeeId },
    });
  },

  async clearEmployeeFilters(adminId: number): Promise<void> {
    const settings = await prisma.adminNotificationSettings.findUnique({ where: { adminId } });
    if (!settings) return;
    await prisma.adminNotificationFilter.deleteMany({ where: { settingsId: settings.id } });
  },

  async getFeed(
    adminId: number,
    page: number,
    useFilter: boolean,
    filterEmpIds?: string,
    filterTypes?: string,
    filterFrom?: string,
    filterTo?: string,
  ): Promise<{
    items: Array<Notification & { employee: Employee; isRead: boolean; isBookmarked: boolean }>;
    total: number;
    unreadTotal: number;
  }> {
    // Build WHERE clause
    const where: Record<string, unknown> = {};

    if (useFilter) {
      // settings-mode: use admin's push settings
      const settings = await notificationService.getOrCreateSettings(adminId);
      const enabledTypes = (Object.keys(TYPE_TO_PUSH_FIELD) as TimeEntryType[]).filter(
        t => settings[TYPE_TO_PUSH_FIELD[t] as keyof typeof settings] === true
      );
      where['type'] = { in: enabledTypes };
      if (settings.employeeFilters.length > 0) {
        where['employeeId'] = { in: settings.employeeFilters.map(f => f.employeeId) };
      }
    } else {
      // custom filter mode
      if (filterEmpIds && filterEmpIds.length > 0) {
        where['employeeId'] = { in: filterEmpIds.split(',').map(Number) };
      }
      if (filterTypes && filterTypes.length > 0) {
        where['type'] = { in: filterTypes.split(',') as TimeEntryType[] };
      }
      if (filterFrom || filterTo) {
        const tsFilter: Record<string, Date> = {};
        if (filterFrom) tsFilter['gte'] = new Date(`${filterFrom}T00:00:00.000Z`);
        if (filterTo)   tsFilter['lte'] = new Date(`${filterTo}T23:59:59.999Z`);
        where['createdAt'] = tsFilter;
      }
    }

    const [notifications, total, unreadTotal] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          employee: true,
          reads: { where: { adminId } },
        },
      }),
      prisma.notification.count({ where }),
      notificationService.getUnreadCount(adminId),
    ]);

    const items = notifications.map(n => {
      const read = n.reads[0];
      return {
        ...n,
        isRead: !!read,
        isBookmarked: !!(read?.bookmarked),
      };
    });

    return { items, total, unreadTotal };
  },

  async getBookmarkedFeed(
    adminId: number,
    page: number,
  ): Promise<{
    items: Array<Notification & { employee: Employee; isRead: boolean; isBookmarked: boolean }>;
    total: number;
  }> {
    const [reads, total] = await Promise.all([
      prisma.notificationRead.findMany({
        where: { adminId, bookmarked: true },
        orderBy: { notification: { createdAt: 'desc' } },
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          notification: {
            include: { employee: true },
          },
        },
      }),
      prisma.notificationRead.count({ where: { adminId, bookmarked: true } }),
    ]);

    const items = reads.map(r => ({
      ...r.notification,
      isRead: true,
      isBookmarked: true,
    }));

    return { items, total };
  },

  async getUnreadCount(adminId: number): Promise<number> {
    // Unread = no NotificationRead record
    const totalNotifications = await prisma.notification.count();
    const readCount = await prisma.notificationRead.count({ where: { adminId } });
    return Math.max(0, totalNotifications - readCount);
  },

  async markAllRead(adminId: number): Promise<void> {
    // Find all notification IDs not yet read by this admin
    const allIds = await prisma.notification.findMany({
      select: { id: true },
    });
    const readIds = await prisma.notificationRead.findMany({
      where: { adminId },
      select: { notificationId: true },
    });
    const readSet = new Set(readIds.map(r => r.notificationId));
    const unreadIds = allIds.map(n => n.id).filter(id => !readSet.has(id));

    if (unreadIds.length === 0) return;

    await prisma.notificationRead.createMany({
      data: unreadIds.map(notificationId => ({ notificationId, adminId })),
      skipDuplicates: true,
    });
  },

  async toggleBookmark(adminId: number, notificationId: number): Promise<void> {
    const existing = await prisma.notificationRead.findUnique({
      where: { notificationId_adminId: { notificationId, adminId } },
    });
    if (existing) {
      await prisma.notificationRead.update({
        where: { notificationId_adminId: { notificationId, adminId } },
        data: { bookmarked: !existing.bookmarked },
      });
    } else {
      // Create as read + bookmarked
      await prisma.notificationRead.create({
        data: { notificationId, adminId, bookmarked: true },
      });
    }
  },
};
