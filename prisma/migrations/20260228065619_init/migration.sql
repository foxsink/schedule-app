-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "TimeEntryType" AS ENUM ('WORK_START', 'WORK_END', 'LUNCH_START', 'LUNCH_END', 'PERSONAL_LEAVE_START', 'PERSONAL_LEAVE_END', 'SICK_LEAVE');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('BONUS', 'PENALTY');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('TIME_ENTRY', 'SALARY_ADJUSTMENT', 'EMPLOYEE', 'EMPLOYEE_RATE');

-- CreateTable
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT,
    "telegramUsername" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "invitationCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "address" TEXT,
    "emergencyPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeRate" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "type" "TimeEntryType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdjustment" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "editorId" INTEGER NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "Employee_telegramId_key" ON "Employee"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_invitationCode_key" ON "Employee"("invitationCode");

-- CreateIndex
CREATE INDEX "EmployeeRate_employeeId_effectiveFrom_idx" ON "EmployeeRate"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_date_idx" ON "TimeEntry"("employeeId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_date_idx" ON "TimeEntry"("date");

-- CreateIndex
CREATE INDEX "SalaryAdjustment_employeeId_date_idx" ON "SalaryAdjustment"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_editorId_idx" ON "AuditLog"("editorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

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
ALTER TABLE "EmployeeRate" ADD CONSTRAINT "EmployeeRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
