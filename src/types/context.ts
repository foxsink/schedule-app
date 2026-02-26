import { Context, Scenes } from 'telegraf';
import { Employee } from '../generated/prisma/client';

export interface SessionData extends Scenes.WizardSessionData {
  selectedEmployeeId?: number;
  selectedDate?: string;
  selectedPeriodFrom?: string;
  selectedPeriodTo?: string;
  // Notification feed state
  notifPage?: number;
  notifTab?: 'all' | 'bookmarks';
  notifFilterMode?: 'settings' | 'custom';
  notifFilterEmpId?: number;
  notifFilterTypes?: string;  // CSV of TimeEntryType, '' = all
  notifFilterFrom?: string;   // YYYY-MM-DD
  notifFilterTo?: string;
}

export interface BotContext extends Context {
  session: Scenes.WizardSession<SessionData>;
  scene: Scenes.SceneContextScene<BotContext, SessionData>;
  wizard: Scenes.WizardContextWizard<BotContext>;
  employee?: Employee | null;
}
