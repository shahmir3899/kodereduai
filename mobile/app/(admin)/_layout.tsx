import React from 'react';
import { Tabs } from 'expo-router';
import Icon from '../../components/ui/Icon';
import RoleGuard from '../../components/nav/RoleGuard';
import { Colors, FontSize } from '../../constants/colors';

export default function AdminLayout() {
  return (
    <RoleGuard persona="admin">
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTitleStyle: { fontWeight: '600', fontSize: FontSize.lg },
        headerTintColor: Colors.text,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          paddingBottom: 4,
          height: 56,
        },
        tabBarLabelStyle: {
          fontSize: FontSize.xs,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Icon name="grid-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: 'Attendance',
          headerShown: false,
          tabBarIcon: ({ color }) => <Icon name="camera-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="finance"
        options={{
          title: 'Finance',
          headerShown: false,
          tabBarIcon: ({ color }) => <Icon name="cash-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: 'Students',
          headerShown: false,
          tabBarIcon: ({ color }) => <Icon name="school-outline" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => <Icon name="menu-outline" size={22} color={color} />,
        }}
      />
      {/* Hidden screens — accessed via "More" or deep navigation */}
      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="hr" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="hostel" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="transport" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="library" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="timetable" options={{ href: null }} />
      <Tabs.Screen name="results" options={{ href: null }} />
      <Tabs.Screen name="classes" options={{ href: null, title: 'Classes' }} />
      <Tabs.Screen name="assignments" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="report-cards" options={{ href: null, title: 'Report Cards' }} />
      <Tabs.Screen name="assessments" options={{ href: null, title: 'Assessments' }} />
      <Tabs.Screen name="marks-entry" options={{ href: null, title: 'Marks Entry' }} />
      <Tabs.Screen name="ai-assistant" options={{ href: null }} />
      <Tabs.Screen name="face-attendance" options={{ href: null, headerShown: false }} />
    </Tabs>
    </RoleGuard>
  );
}
