import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import type { IconName } from '../ui/Icon';
import RoleGuard from './RoleGuard';
import { renderTabBar, tabIcon, useTabScreenOptions } from './tabBarStyle';
import { SideMenuProvider, useSideMenu } from './SideMenuContext';
import SideMenu from './SideMenu';
import MenuButton from './MenuButton';
import BackButton from './BackButton';
import { TabNamesContext } from './RoleStack';
import type { Persona } from '../../navigation/personas';

export interface TabSpec {
  name: string;
  title: string;
  icon: IconName;
  // The tab's screen is a folder with its own Stack and header.
  stack?: boolean;
}

interface Props {
  persona: Persona;
  tabs: TabSpec[];
  hidden?: string[];
  stacks?: string[];
  titles?: Record<string, string>;
}

// Shared shell for the staff-type groups so each group's _layout is just its tab list.
// `stacks` are hidden folders with their own Stack navigator (and header), so the tab header is off.
// `hidden` routes live in the group but have no tab; they open from More or from other screens.
// `titles` names them in the header (otherwise it shows the raw route name).
// Every role gets the admin's side menu: it slides in from the left (a permanent rail on wide
// screens), the "more" tab opens it on a phone and every tab's header gets a menu button; screens
// with no tab of their own get a back arrow instead.
export default function PersonaTabs(props: Props) {
  return (
    <SideMenuProvider>
      <PersonaTabsInner {...props} />
    </SideMenuProvider>
  );
}

function PersonaTabsInner({ persona, tabs, hidden = [], stacks = [], titles = {} }: Props) {
  const screenOptions = useTabScreenOptions();
  const menu = useSideMenu();
  const tabNames = React.useMemo(() => new Set(tabs.map((t) => t.name)), [tabs]);
  const tabsView = (
    <Tabs
      screenOptions={screenOptions}
      tabBar={renderTabBar}
      // The Android back key returns to the screen you came from, not always the first tab.
      backBehavior="history"
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          // The More page stays as the route behind the tab, and is what a docked rail leaves it as.
          listeners={t.name === 'more' ? { tabPress: (e) => { if (!menu.docked) { e.preventDefault(); menu.open(); } } } : undefined}
          options={{
            title: t.title,
            // Stacks have their own header; Home's blue banner carries the menu, bell and photo.
            ...(t.stack || t.name === 'dashboard' ? { headerShown: false } : {}),
            headerLeft: () => <MenuButton />,
            tabBarIcon: tabIcon(t.icon),
          }}
        />
      ))}
      {hidden.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null, headerLeft: () => <BackButton />, ...(titles[name] ? { title: titles[name] } : {}) }} />
      ))}
      {stacks.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null, headerShown: false }} />
      ))}
    </Tabs>
  );
  return (
    <RoleGuard persona={persona}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {menu.docked ? <SideMenu /> : null}
        <View style={{ flex: 1 }}>
          <TabNamesContext.Provider value={tabNames}>{tabsView}</TabNamesContext.Provider>
          {menu.docked ? null : <SideMenu />}
        </View>
      </View>
    </RoleGuard>
  );
}
