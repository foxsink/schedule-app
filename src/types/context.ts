import { Context, Scenes } from 'telegraf';
import { Employee } from '../generated/prisma/client';

export interface SessionData extends Scenes.WizardSessionData {
  selectedEmployeeId?: number;
  selectedDate?: string;
  selectedPeriodFrom?: string;
  selectedPeriodTo?: string;
  pendingStartTime?: string; // ISO timestamp for the start half of a pair (lunch/absence)
}

export interface BotContext extends Context {
  session: Scenes.WizardSession<SessionData>;
  scene: Scenes.SceneContextScene<BotContext, SessionData>;
  wizard: Scenes.WizardContextWizard<BotContext>;
  employee?: Employee | null;
}
