import React from 'react';
import { Tabs } from 'expo-router';
import Icon, { type IconName } from '../ui/Icon';
import RoleGuard from './RoleGuard';
import { useTabScreenOptions } from './tabBarStyle';
import type { Persona } from '../../navigation/personas';

export interface TabSpec {
  name: string;
  title: string;
  icon: IconName;
  // The tab's screen is a folder with its own Stack and header.
  stack?: boolean;
}

// Shared shell for the staff-type groups so each group's _layout is just its tab list.
// `stacks` are hidden folders with their own Stack navigator (and header), so the tab header is off.
// `hidden` routes live in the group but have no tab; they open from More or from other screens.
// `titles` names them in the header (otherwise it shows the raw route name).
export default function PersonaTabs({ persona, tabs, hidden = [], stacks = [], titles = {} }: { persona: Persona; tabs: TabSpec[]; hidden?: string[]; stacks?: string[]; titles?: Record<string, string> }) {
  const screenOptions = useTabScreenOptions();
  return (
    <RoleGuard persona={persona}>
      <Tabs
        screenOptions={screenOptions}
      >
        {tabs.map((t) => (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              ...(t.stack ? { headerShown: false } : {}),
              tabBarIcon: ({ color }) => <Icon name={t.icon} size={22} color={color} />,
            }}
          />
        ))}
        {hidden.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null, ...(titles[name] ? { title: titles[name] } : {}) }} />
        ))}
        {stacks.map((name) => (
          <Tabs.Screen key={name} name={name} options={{ href: null, headerShown: false }} />
        ))}
      </Tabs>
    </RoleGuard>
  );
}
