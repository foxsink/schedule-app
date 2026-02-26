import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { employeeService } from '../../services/employee.service';
import { EMPLOYEE_MENU_SCENE_ID } from './menu.scene';

export const ONBOARDING_SCENE_ID = 'onboarding';

const SKIP = 'Пропустить →';

export const onboardingScene = new Scenes.WizardScene<BotContext>(
  ONBOARDING_SCENE_ID,

  // Step 0: Phone
  async (ctx) => {
    await ctx.reply(
      '📱 Шаг 1/3: Номер телефона\nНажмите кнопку или пропустите.',
      Markup.keyboard([
        [Markup.button.contactRequest('📱 Поделиться номером')],
        [SKIP],
      ]).resize().oneTime(),
    );
    return ctx.wizard.next();
  },

  // Step 1: Handle phone, ask address
  async (ctx) => {
    if (!ctx.message) return;

    if ('contact' in ctx.message && ctx.message.contact) {
      const phone = ctx.message.contact.phone_number;
      if (ctx.employee) {
        await employeeService.updateProfile(ctx.employee.id, { phone });
      }
    } else if ('text' in ctx.message && ctx.message.text !== SKIP) {
      // If they typed something other than skip — treat as text phone
      const phone = ctx.message.text.trim();
      if (ctx.employee) {
        await employeeService.updateProfile(ctx.employee.id, { phone });
      }
    }
    // If SKIP, do nothing

    await ctx.reply(
      '🏠 Шаг 2/3: Адрес\nВведите адрес или пропустите.',
      Markup.keyboard([[SKIP]]).resize().oneTime(),
    );
    return ctx.wizard.next();
  },

  // Step 2: Handle address, ask emergency
  async (ctx) => {
    if (!ctx.message) return;

    if ('text' in ctx.message && ctx.message.text !== SKIP) {
      const address = ctx.message.text.trim();
      if (ctx.employee) {
        await employeeService.updateProfile(ctx.employee.id, { address });
      }
    }

    await ctx.reply(
      '🆘 Шаг 3/3: Экстренный контакт\nВведите имя и номер или пропустите.',
      Markup.keyboard([[SKIP]]).resize().oneTime(),
    );
    return ctx.wizard.next();
  },

  // Step 3: Handle emergency, done
  async (ctx) => {
    if (!ctx.message) return;

    if ('text' in ctx.message && ctx.message.text !== SKIP) {
      const emergencyPhone = ctx.message.text.trim();
      if (ctx.employee) {
        await employeeService.updateProfile(ctx.employee.id, { emergencyPhone });
      }
    }

    await ctx.reply('✅ Профиль заполнен!', Markup.removeKeyboard());
    return ctx.scene.enter(EMPLOYEE_MENU_SCENE_ID);
  },
);
