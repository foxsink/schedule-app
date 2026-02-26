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
  notifFilterEmpIds?: string;  // CSV of employee IDs, '' = all
  notifFilterTypes?: string;   // CSV of TimeEntryType, '' = all
  notifFilterFrom?: string;    // YYYY-MM-DD
  notifFilterTo?: string;
  notifFilterStep?: number;    // 1 | 2 | 3 (wizard step)
}

export interface BotContext extends Context {
  session: Scenes.WizardSession<SessionData>;
  scene: Scenes.SceneContextScene<BotContext, SessionData>;
  wizard: Scenes.WizardContextWizard<BotContext>;
  employee?: Employee | null;
}
