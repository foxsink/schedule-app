-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "type" "TimeEntryType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "adminId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookmarked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotificationSettings" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyWorkStart" BOOLEAN NOT NULL DEFAULT true,
    "notifyWorkEnd" BOOLEAN NOT NULL DEFAULT true,
    "notifyLunchStart" BOOLEAN NOT NULL DEFAULT true,
    "notifyLunchEnd" BOOLEAN NOT NULL DEFAULT true,
    "notifyPersonalLeaveStart" BOOLEAN NOT NULL DEFAULT true,
    "notifyPersonalLeaveEnd" BOOLEAN NOT NULL DEFAULT true,
    "notifySickLeave" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminNotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminNotificationFilter" (
    "id" SERIAL NOT NULL,
    "settingsId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,

    CONSTRAINT "AdminNotificationFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_employeeId_createdAt_idx" ON "Notification"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationRead_adminId_idx" ON "NotificationRead"("adminId");

-- CreateIndex
CREATE INDEX "NotificationRead_adminId_bookmarked_idx" ON "NotificationRead"("adminId", "bookmarked");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_notificationId_adminId_key" ON "NotificationRead"("notificationId", "adminId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotificationSettings_adminId_key" ON "AdminNotificationSettings"("adminId");

-- CreateIndex
CREATE INDEX "AdminNotificationFilter_settingsId_idx" ON "AdminNotificationFilter"("settingsId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotificationFilter_settingsId_employeeId_key" ON "AdminNotificationFilter"("settingsId", "employeeId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationSettings" ADD CONSTRAINT "AdminNotificationSettings_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationFilter" ADD CONSTRAINT "AdminNotificationFilter_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "AdminNotificationSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotificationFilter" ADD CONSTRAINT "AdminNotificationFilter_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
