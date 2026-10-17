import React from 'react';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { entriesFromStore, openStore, runNoticeAction } from './reminder-notifications';
import { DONE_CLICK, ReminderWidget } from './reminder-widget';
import { T, refreshTheme } from './ui';

// Android asks for the Reminders widget (placed, resized, every 30 minutes) or reports a tap
// on its circle; runs headless when the app is closed (registered from index.ts).
registerWidgetTaskHandler(async ({ widgetAction, clickAction, clickActionData, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED') return;
  try {
    if (widgetAction === 'WIDGET_CLICK' && clickAction === DONE_CLICK && typeof clickActionData?.notice === 'string') {
      await runNoticeAction(clickActionData.notice, 'done');
    }
    refreshTheme();
    const opened = await openStore();
    if (!opened) {
      renderWidget(
        <FlexWidget clickAction="OPEN_APP" style={{ height: 'match_parent', width: 'match_parent', alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface_container as `#${string}`, borderRadius: 24 }}>
          <TextWidget text="Open Noted to see reminders" style={{ fontSize: 14, color: T.on_surface_variant as `#${string}` }} />
        </FlexWidget>,
      );
      return;
    }
    renderWidget(<ReminderWidget entries={await entriesFromStore(opened.masterKey, opened.store)} now={new Date()} />);
  } catch (e) {
    console.warn('Reminder widget task:', e);
  }
});
