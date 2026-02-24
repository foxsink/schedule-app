import { Context, Scenes } from 'telegraf';
import { Employee } from '@prisma/client';

export interface SessionData extends Scenes.SceneSessionData {
  selectedEmployeeId?: number;
  selectedDate?: string;
  selectedPeriodFrom?: string;
  selectedPeriodTo?: string;
}

export interface BotContext extends Context {
  session: SessionData;
  scene: Scenes.SceneContextScene<BotContext, SessionData>;
  wizard: Scenes.WizardContextWizard<BotContext>;
  employee?: Employee | null;
}
